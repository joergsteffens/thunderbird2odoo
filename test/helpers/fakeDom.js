// Minimal DOM, just enough for displayScript.js and options.js: elements
// with children, style, events and <select>/<option> value handling.

class FakeElement {
  constructor(tagName, doc) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = doc;
    this.children = [];
    this.parentElement = null;
    this.style = { cssText: "", display: "", color: "" };
    this.listeners = {};
    this.id = "";
    this.disabled = false;
    this.checked = false;
    this.title = "";
    this._text = "";
    this._value = undefined;
  }

  get textContent() {
    return this._text + this.children.map((c) => c.textContent).join("");
  }

  set textContent(text) {
    this.children = [];
    this._text = String(text);
  }

  set innerHTML(html) {
    if (html !== "") throw new Error("fake innerHTML only supports clearing");
    this.children = [];
    this._text = "";
    this._value = undefined;
  }

  get firstChild() {
    return this.children[0] || null;
  }

  get options() {
    return this.children.filter((c) => c.tagName === "OPTION");
  }

  get value() {
    if (this.tagName === "SELECT") {
      const opts = this.options;
      if (this._value === undefined) return opts[0] ? opts[0].value : "";
      return opts.some((o) => o.value === this._value) ? this._value : "";
    }
    if (this.tagName === "OPTION" && this._value === undefined)
      return this.textContent;
    return this._value === undefined ? "" : this._value;
  }

  set value(v) {
    this._value = String(v);
  }

  appendChild(child) {
    child.remove();
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  insertBefore(child, ref) {
    child.remove();
    child.parentElement = this;
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) this.children.push(child);
    else this.children.splice(i, 0, child);
    return child;
  }

  remove() {
    if (!this.parentElement) return;
    const siblings = this.parentElement.children;
    siblings.splice(siblings.indexOf(this), 1);
    this.parentElement = null;
  }

  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }

  /** Runs the listeners and returns their (async) results. */
  dispatch(type, event = {}) {
    const ev = { preventDefault() {}, target: this, ...event };
    return Promise.all((this.listeners[type] || []).map((fn) => fn(ev)));
  }

  click() {
    if (this.disabled) return Promise.resolve([]);
    return this.dispatch("click");
  }

  /** All descendants, depth first. */
  *walk() {
    for (const c of this.children) {
      yield c;
      yield* c.walk();
    }
  }
}

class FakeTextNode extends FakeElement {
  constructor(text, doc) {
    super("#text", doc);
    this._text = String(text);
  }
}

export class FakeDocument {
  constructor() {
    this.body = new FakeElement("body", this);
    this.detached = new Map(); // id -> element not attached to body
  }

  createElement(tag) {
    return new FakeElement(tag, this);
  }

  addEventListener() {}

  createTextNode(text) {
    return new FakeTextNode(text, this);
  }

  getElementById(id) {
    for (const el of this.body.walk()) if (el.id === id) return el;
    return this.detached.get(id) || null;
  }

  /** Adds an element to the body (e.g. from a parsed HTML page). */
  add(tag, id, props = {}) {
    const el = this.createElement(tag);
    el.id = id;
    Object.assign(el, props);
    this.body.appendChild(el);
    return el;
  }

  query(predicate) {
    return [...this.body.walk()].filter(predicate);
  }
}

/**
 * Builds a FakeDocument with the elements of an HTML page that carry an id.
 * Keeps what the scripts rely on: the tag, the `disabled`/`checked`
 * attributes and the <option>s of each <select>. Nesting is not kept.
 */
export function documentFromHtml(html) {
  const doc = new FakeDocument();
  const tagRe = /<(\w+)\b([^>]*)\bid="([^"]+)"([^>]*)>/g;
  let m;
  while ((m = tagRe.exec(html))) {
    const [, tag, before, id, after] = m;
    const attrs = before + " " + after;
    const el = doc.add(tag, id, {
      disabled: /\sdisabled\b/.test(attrs),
      checked: /\schecked\b/.test(attrs),
    });
    if (tag === "select") {
      const end = html.indexOf("</select>", m.index);
      const inner = html.slice(m.index, end);
      const optRe = /<option\s+value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/g;
      let o;
      while ((o = optRe.exec(inner))) {
        const opt = doc.createElement("option");
        opt.value = o[1];
        opt.textContent = o[2].trim().replace(/\s+/g, " ");
        el.appendChild(opt);
      }
    }
  }
  return doc;
}
