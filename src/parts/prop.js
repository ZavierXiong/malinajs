
import { assert, detectExpressionType, isSimpleName } from '../utils.js'


export function bindProp(prop, makeEl, node) {
    let name, arg;
    if(prop.name[0] == '@') {
        arg = prop.name.substring(1);
        name = 'on';
    }
    if(!name && prop.name[0] == ':') {
        name = 'bind';
        arg = prop.name.substring(1);
    }
    if(!name && prop.name[0] == '*') {
        let rx = prop.name.match(/^\*\{.*\}$/);
        if(rx) {
            assert(prop.value == null, 'wrong binding: ' + prop.content);
            name = 'use';
            prop.value = prop.name.substring(1);
        } else {
            name = 'use';
            arg = prop.name.substring(1);
        }
    }
    if(!name && prop.value == null) {
        let rx = prop.name.match(/^\{(.*)\}$/);
        if(rx) {
            name = rx[1];
            prop.value = prop.name;
        }
    }
    if(!name) {
        let r = prop.name.match(/^(\w+)\:(.*)$/)
        if(r) {
            name = r[1];
            arg = r[2];
        } else name = prop.name;
    }

    function getExpression() {
        let exp = prop.value.match(/^\{(.*)\}$/)[1];
        assert(exp, prop.content);
        return exp;
    }

    if(name[0] == '#') {
        let target = name.substring(1);
        assert(isSimpleName(target), target);
        this.checkRootName(target);
        return {bind: `${target}=${makeEl()};`};
    } else if(name == 'on') {
        let mod = '', opts = arg.split(/[\|:]/);
        let event = opts.shift();
        let exp, handler, funcName;
        if(prop.value) {
            exp = getExpression();
        } else {
            if(!opts.length) {
                // forwarding
                return {bind: `
                    $cd.ev(${makeEl()}, "${event}", ($event) => {
                        const fn = $option.events && $option.events.${event};
                        if(fn) fn($event);
                    });\n`
                };
            }
            handler = opts.pop();
        };
        assert(event, prop.content);
        assert(!handler ^ !exp, prop.content);

        let needPrevent, preventInserted;
        opts.forEach(opt => {
            if(opt == 'preventDefault') {
                if(preventInserted) return;
                mod += '$event.preventDefault();';
                preventInserted = true;
            } else if(opt == 'enter') {
                mod += 'if($event.keyCode != 13) return;';
                needPrevent = true;
            } else if(opt == 'escape') {
                mod += 'if($event.keyCode != 27) return;';
                needPrevent = true;
            } else throw 'Wrong modificator: ' + opt;
        });
        if(needPrevent && !preventInserted) mod += '$event.preventDefault();';

        if(exp) {
            let type = detectExpressionType(exp);
            if(type == 'identifier') {
                handler = exp;
                exp = null;
            } else if(type == 'function') {
                funcName = 'fn' + (this.uniqIndex++);
            };
        }

        if(funcName) {
            return {bind: `
                {
                    let $element=${makeEl()};
                    const ${funcName} = ${exp};
                    $cd.ev($element, "${event}", ($event) => { ${mod} $$apply(); ${funcName}($event);});
                }`
            };
        } else if(handler) {
            this.checkRootName(handler);
            return {bind: `
                {
                    let $element=${makeEl()};
                    $cd.ev($element, "${event}", ($event) => { ${mod} $$apply(); ${handler}($event);});
                }`
            };
        } else {
            return {bind: `
                {
                    let $element=${makeEl()};
                    $cd.ev($element, "${event}", ($event) => { ${mod} $$apply(); ${this.Q(exp)}});
                }`
            };
        }
    } else if(name == 'bind') {
        let exp;
        arg = arg.split(/[\:\|]/);
        let attr = arg.shift();
        assert(attr, prop.content);

        if(prop.value) exp = getExpression();
        else {
            if(arg.length) exp = arg.pop();
            else exp = attr;
        }
        assert(['value', 'checked', 'valueAsNumber', 'valueAsDate', 'selectedIndex'].includes(attr), 'Not supported: ' + prop.content);
        assert(arg.length == 0);
        assert(detectExpressionType(exp) == 'identifier', 'Wrong bind name: ' + prop.content);
        let watchExp = attr == 'checked' ? '!!' + exp : exp;

        return {bind: `{
            let $element=${makeEl()};
            $cd.ev($element, 'input', () => { ${exp}=$element.${attr}; $$apply(); });
            $watchReadOnly($cd, () => (${watchExp}), (value) => { if(value != $element.${attr}) $element.${attr} = value; });
        }`};
    } else if(name == 'class' && arg) {
        let className = arg;
        let exp = prop.value ? getExpression() : className;
        return {bind: `{
                let $element = ${makeEl()};
                $watchReadOnly($cd, () => !!(${exp}), (value) => { if(value) $element.classList.add("${className}"); else $element.classList.remove("${className}"); });
            }`};
    } else if(name == 'style' && arg) {
        let styleName = arg;
        let exp = prop.value ? getExpression() : styleName;
        return {bind: `{
                let $element = ${makeEl()};
                $watchReadOnly($cd, () => (${exp}), (value) => { $element.style.${styleName} = value; });
            }`};
    } else if(name == 'use') {
        if(arg) {
            assert(isSimpleName(arg), 'Wrong name: ' + arg);
            this.checkRootName(arg);
            let args = prop.value ? getExpression() : '';
            let code = `$cd.once(() => {
                let useObject = ${arg}(${makeEl()}${args ? ', ' + args : ''});\n if(useObject) {`;
            if(args) code += `
                if(useObject.update) {
                    let w = $watch($cd, () => [${args}], (args) => {useObject.update.apply(useObject, args);}, {cmp: $$compareArray});
                    w.value = w.fn();
                }`;
            code += `if(useObject.destroy) $cd.d(useObject.destroy);}});`;
            return {bind: code};
        }
        let exp = getExpression();
        return {bind: `{
            let $element=${makeEl()};
            $cd.once(() => { $$apply(); ${exp}; });}`};
    } else {
        if(prop.value && prop.value.indexOf('{') >= 0) {
            let exp = this.parseText(prop.value);
            const propList = {
                hidden: true,
                checked: true,
                value: true,
                disabled: true,
                selected: true,
                innerHTML: true,
                innerText: true,
                placeholder: true,
                src: true
            }
            if(propList[name]) {
                return {bind: `{
                    let $element=${makeEl()};
                    $watchReadOnly($cd, () => (${exp}), (value) => {$element.${name} = value;});
                }`};
            } else {
                let scopedClass = name == 'class' && this.css;  // scope any dynamic class
                let suffix = scopedClass ? `+' ${this.css.id}'` : '';
                return {
                    bind: `{
                        let $element=${makeEl()};
                        $watchReadOnly($cd, () => (${exp})${suffix}, (value) => {
                            if(value) $element.setAttribute('${name}', value);
                            else $element.removeAttribute('${name}');
                        });
                    }`,
                    scopedClass: scopedClass
                };
            }
        }
        if(name == 'class' && node.scopedClass) {
            let classList = prop.value.trim();
            if(classList) classList += ' ';
            classList += this.css.id;

            return {
                prop: `class="${classList}"`,
                scopedClass: true
            }
        }
        return {
            prop: prop.content
        }
    }
};
