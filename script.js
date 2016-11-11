var is = {
    fn: function(val) { return typeof val === "function" },
    obj: function(val) { return typeof val === "object" },
    str: function(val) { return typeof val === "string" },
    undef: function(val) { return typeof val === "undefined" },
    bool: function(val) { return typeof val === "boolean" }
};

function Collection(_collection) {
    var self = this;
    var collection = _collection || [];
    if (collection instanceof Collection) {
        collection = collection.collection;
    }
    self.collection = collection;

    self.each = function(cb) {
        var keys = Object.keys(collection);
        for (var i = 0; i < keys.length; i++) {
            var result = cb(collection[keys[i]], keys[i]);
            if (is.bool(result) && !result) {
                break;
            }
        }
        return self;
    };

    self.push = function(value) {
        collection.push(value);
    };
};

function collect(collection) {
    return new Collection(collection);
}

function Observable(scope, key, value, parent) {
    var self = this;
    var observers = collect();

    var desc = Object.getOwnPropertyDescriptor(scope, key) || {};
    var getter = desc.get || function() { return value };
    var setter = desc.set;
    var prevValue = getter();

    self.$key = key;
    self.$parent = parent;
    self.$children = collect();
    self.$uid = Observable.uid++;
    if (parent && parent.$children) {
        parent.$children.push(self);
    }

    Object.defineProperty(scope, key, {
        get: function() {
            return getter();
        },
        set: function(val) {
            prevValue = value;
            value = val;
            if (setter) setter(value);
            self.$notifyAll();
        }
    });

    self.$observe = function(observer) {
        observers.push(observer);
    };

    self.$notify = function() {
        var val = getter();
        observers.each(function(observer) {
            observer(val, prevValue);
        });
    };

    self.$notifyChildren = function() {
        self.$children.each(function(child) {
            if (child && child.$notify) {
                child.$notify();
                child.$notifyChildren();
            }
        });
    };

    self.$notifyParent = function() {
        if (parent && parent.$notify) {
            parent.$notify();
            parent.$notifyParent();
        }
    };

    self.$notifyAll = function() {
        self.$notifyChildren();
        self.$notify();
        self.$notifyParent();
    };
}

Observable.uid = 0;

var directives = collect();

function ViewModel($el, $options) {
    var self = this;

    self.$notify = function(exp) {
        if (is.undef(exp)) {
            collect(self.$observables).each(function(observer) {
                observer.$notify();
            });
        } else {
            var observable = observableExp(exp);
            if (observable) {
                observable.$notifyAll();
            }
        }
    };

    self.$compile = function(dom) {
        if (typeof dom == "string") {
            dom = document.querySelector(dom);
            return self.$compile(dom);
        }
        if (dom.nodeType != 1) return;

        if (parseDirective(dom)) {
            parseExpression(dom)
            dom.childNodes.forEach(self.$compile);
        }
    };

    self.$bindDOM = function(dom, exp, props, watch, scope) {
        scope = scope || self;
        exp = exp.trim();
        var getter = makeGetterFn(exp);
        dom[props.attr] = getter(scope);
        var observer;
        if (!exp.match(/\(.*\)$/)) {
            observer = createObserver(exp, function() {
                dom[props.attr] = getter(scope);
            });
        }
        if (observer && watch) {
            var setter = makeSetterFn(exp);
            dom.addEventListener(props.event, function(evt) {
                setter(scope, evt.target.value);
            });
        }
    };

    self.$exp = function(exp, scope) {
        return makeGetterFn(exp)(scope || self);
    };

    self.$registerObservable = function(observable, parent) {
        self.$observables[observable.$uid] = observable;
        if (parent) {
            parent[observable.$key] = observable;
        }
    };

    function initialize() {
        observeData(self.$data, self.$rootObservable);

        collect(self.$data).each(function(value, key) {
            self[key] = value;
            var desc = Object.getOwnPropertyDescriptor(self.$data, key);
            Object.defineProperty(self, key, desc);
        });

        collect($options.methods || {}).each(function(method, name) {
            self[name] = method.bind(self);
        });

        collect($options.computed || {}).each(function(computed, name) {
            computed = computed.bind(self);
            Object.defineProperty(self, name, {
                configurable: true,
                get: function() {
                    return computed();
                }
            });
            var observable = createObservable(self, name, computed(), self.$observables);
            self.$registerObservable(observable, self.$rootObservable);
        });

        collect($options.watch || {}).each(function(watcher, name) {
            createObserver(name, watcher);
        });
    }

    function observeData(data, parent) {
        collect(data).each(function(v, k) {
            var observable = createObservable(data, k, v, parent);
            self.$registerObservable(observable, parent);
            if (is.obj(v)) {
                observeData(v, parent[observable.$key]);
            }
        });
        return parent;
    }

    function createObservable(data, key, value, parent) {
        return new Observable(data, key, value, parent);
    }

    function createObserver(name, callback, scope) {
        var observable = observableExp(name);
        if (!observable) return null;
        observable.$observe(callback.bind(scope || self));
        return callback;
    }

    function parseDirective(dom) {
        var keepTraversing = true;
        directives.each(function(directive) {
            var exp = dom.getAttribute(directive.name);
            if (!exp) return;
            dom.removeAttribute(directive.name);
            keepTraversing = directive.handle.call(self, dom, exp);
            return is.undef(keepTraversing) ? true : keepTraversing;
        });
        return keepTraversing;
    }

    function parseExpression(dom) {
        var html = dom.innerHTML;
        if (!html) return;
        var exp = html.match(/^{{(.+)}}$/);
        if (!exp) return;
        exp = exp[1];
        self.$bindDOM(dom, exp, {
            attr: "innerHTML"
        });
    }

    function makeGetterFn(exp) {
        return new Function("scope", "return scope." + exp + " || ''");
    }

    function makeSetterFn(exp) {
        return new Function("scope", "value", "scope." + exp + " = value");
    }

    function makeObservableFn(exp) {
        try {
            return new Function("observable", "return observable." + exp);
        } catch(e) {
            throw new Error("Error while parsing expression for observable: " + exp);
        }
    }

    function observableExp(exp) {
        if (exp == "$root") {
            return self.$rootObservable;
        } else {
            try {
                return makeObservableFn(exp)(self.$rootObservable);
            } catch (e) {
                console.warn("Error evaluating expression for observable: " + exp);
                return null;
            }
        }
    }

    self.$el = $el;
    self.$options = $options;
    self.$rootObservable = createObservable(self, "$root", null);
    self.$observables = {};
    self.$data = $options.data || {};
    self.$registerObservable(self.$rootObservable);

    initialize();
    self.$compile($el);
}

directives.push({
    name: "vm-repeat",
    handle: function($dom, exp) {
        var html = $dom.outerHTML;
        var parent = $dom.parentNode;
        parent.innerHTML = "";

        var parsed = exp.match(/^([^\s]+) in ([^\s]+)$/);
        if (!parsed) {
            throw new Error("Error while parsing expression: " + exp);
        }

        var key = parsed[2];
        collect(this[key]).each(function(item, idx) {
            var dom = document.createElement("div");
            dom.innerHTML = html.replace(parsed[1], parsed[2] + "[" + idx + "]");
            dom = dom.childNodes[0];
            parent.appendChild(dom);
        });

        this.$compile(parent);
        return false;
    }
});

directives.push({
    name: "vm-model",
    handle: function(dom, exp) {
        this.$bindDOM(dom, exp, {
            attr: "value",
            event: "input"
        }, true);
    }
});

window.vm = new ViewModel("#app", {
    data: {
        user: {
            username: "Username"
        },
        fruits: [
            "Apple",
            "Orange",
            "Pineapple"
        ]
    },
    computed: {
        json: function() {
            return JSON.stringify(this.$data, null, "  ");
        }
    },
    methods: {
        hello: function() {
            return "Hello, world!";
        }
    },
    watch: {
        "$root": function() {
            this.$notify("json");
        }
    }
});
