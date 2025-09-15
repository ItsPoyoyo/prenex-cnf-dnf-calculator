// ---------- Small utilities ----------
function deepClone(x) { return JSON.parse(JSON.stringify(x)); }
function isLetter(ch) { return /[A-Za-z_]/.test(ch); }
function isDigit(ch) { return /[0-9]/.test(ch); }
function error(msg) { throw new Error(msg); }

// ---------- Normalization ----------
function normalizeInput(text) {
  if (!text) return '';
  // replace non-breaking spaces
  text = text.replace(/\u00A0/g, ' ');
  // collapse multiple backslashes into one
  text = text.replace(/\\+/g, '\\');
  // remove LaTeX spacing commands -> space
  text = text.replace(/\\,|\\;|\\:|\\!|\\quad|\\qquad|\\ /g, ' ');
  // map LaTeX or ASCII operators to single-char logical symbols
  const map = {
    '\\forall': '∀', '\\exists': '∃', '\\neg': '¬', '\\lnot': '¬',
    '\\land': '∧', '\\lor': '∨', '\\leftrightarrow': '↔', '\\to': '→',
    '<->': '↔', '->': '→',
    '!': '¬', '~': '¬', '&': '∧', '|': '∨'
  };
  // do replacements (simple loop is clear)
  for (const k in map) text = text.split(k).join(map[k]);
  return text;
}

// ---------- Tokenizer ----------
function tokenize(input) {
  const tokens = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (/\s/.test(ch)) { i++; continue; }
    // single-char punctuation
    if ('(),.:'.includes(ch)) { tokens.push({ type: ch, value: ch }); i++; continue; }
    // single-char logical symbols
    if (ch === '∀') { tokens.push({ type: 'forall', value: '∀' }); i++; continue; }
    if (ch === '∃') { tokens.push({ type: 'exists', value: '∃' }); i++; continue; }
    if (ch === '¬') { tokens.push({ type: 'not', value: '¬' }); i++; continue; }
    if (ch === '∧') { tokens.push({ type: 'and', value: '∧' }); i++; continue; }
    if (ch === '∨') { tokens.push({ type: 'or', value: '∨' }); i++; continue; }
    if (ch === '→') { tokens.push({ type: 'implies', value: '→' }); i++; continue; }
    if (ch === '↔') { tokens.push({ type: 'iff', value: '↔' }); i++; continue; }
    // names (letters, digits allowed after first)
    if (isLetter(ch)) {
      let j = i + 1;
      while (j < input.length && /[A-Za-z0-9_]/.test(input[j])) j++;
      tokens.push({ type: 'name', value: input.slice(i, j) });
      i = j;
      continue;
    }
    error('Caractere inesperado: ' + ch);
  }
  return tokens;
}

// ---------- AST factories (standardized shapes) ----------
const Node = {
  ForAll: (variable, body) => ({ kind: 'ForAll', variable, body }),
  Exists: (variable, body) => ({ kind: 'Exists', variable, body }),
  Not: (child) => ({ kind: 'Not', child }),
  And: (left, right) => ({ kind: 'And', left, right }),
  Or: (left, right) => ({ kind: 'Or', left, right }),
  Implies: (left, right) => ({ kind: 'Implies', left, right }),
  Iff: (left, right) => ({ kind: 'Iff', left, right }),
  Pred: (name, args=[]) => ({ kind: 'Pred', name, args })
};
const Term = {
  Var: (name) => ({ term: 'Var', name }),
  Func: (name, args=[]) => ({ term: 'Func', name, args })
};

// ---------- Parser (recursive descent, clearer) ----------
function Parser(tokens) {
  this.tokens = tokens;
  this.i = 0;
}
Parser.prototype.peek = function(offset = 0) { return this.tokens[this.i + offset]; };
Parser.prototype.consume = function(expectedType) {
  const t = this.peek();
  if (!t || (expectedType && t.type !== expectedType)) {
    error('Esperado ' + expectedType + ', obtido ' + (t ? t.type : 'EOF'));
  }
  this.i++;
  return t;
};
Parser.prototype.match = function(type) { const t = this.peek(); if (t && t.type === type) { this.i++; return true; } return false; };

Parser.prototype.parse = function() {
  const f = this.parseIff();
  if (this.peek()) error('Tokens sobrando após a fórmula.');
  return f;
};
// precedence chain: iff -> implies -> or -> and -> unary/atomic
Parser.prototype.parseIff = function() {
  let left = this.parseImplies();
  while (this.match('iff')) { const right = this.parseImplies(); left = Node.Iff(left, right); }
  return left;
};
Parser.prototype.parseImplies = function() {
  let left = this.parseOr();
  while (this.match('implies')) { const right = this.parseOr(); left = Node.Implies(left, right); }
  return left;
};
Parser.prototype.parseOr = function() {
  let left = this.parseAnd();
  while (this.match('or')) { const right = this.parseAnd(); left = Node.Or(left, right); }
  return left;
};
Parser.prototype.parseAnd = function() {
  let left = this.parseUnary();
  while (this.match('and')) { const right = this.parseUnary(); left = Node.And(left, right); }
  return left;
};
Parser.prototype.parseUnary = function() {
  const t = this.peek();
  if (!t) error('Fórmula incompleta.');
  if (t.type === 'not') { this.consume('not'); return Node.Not(this.parseUnary()); }
  if (t.type === 'forall' || t.type === 'exists') {
    const quant = this.consume(t.type).type;
    const vars = this.parseVarList();
    // optional dot or colon
    if (this.match('.') || this.match(':')) {}
    let body = this.parseUnary();
    // multiple variables become nested quantifiers (right-assoc)
    for (let k = vars.length - 1; k >= 0; k--) {
      body = (quant === 'forall') ? Node.ForAll(vars[k], body) : Node.Exists(vars[k], body);
    }
    return body;
  }
  return this.parseAtomic();
};
Parser.prototype.parseVarList = function() {
  const names = [];
  names.push(this.consume('name').value);
  while (this.match(',')) names.push(this.consume('name').value);
  return names;
};
Parser.prototype.parseAtomic = function() {
  if (this.match('(')) { const f = this.parseIff(); this.consume(')'); return f; }
  const t = this.consume('name'); const name = t.value;
  if (this.match('(')) {
    // parse terms list (function/pred args)
    const args = this.parseTermList();
    this.consume(')');
    return Node.Pred(name, args);
  } else {
    // bare name as predicate must start with uppercase (P) else it's invalid atomic usage
    if (/^[A-Z]/.test(name)) return Node.Pred(name, []);
    error('Uso atômico inválido de identificador: ' + name + '. Use Predicados como P(x) ou um nome iniciando com maiúscula.');
  }
};
Parser.prototype.parseTermList = function() {
  const arr = [ this.parseTerm() ];
  while (this.match(',')) arr.push(this.parseTerm());
  return arr;
};
Parser.prototype.parseTerm = function() {
  const t = this.consume('name'); const name = t.value;
  if (this.match('(')) {
    // function application: f(t1, t2, ...)
    const args = [ this.parseTerm() ];
    while (this.match(',')) args.push(this.parseTerm());
    this.consume(')');
    return Term.Func(name, args);
  }
  return Term.Var(name);
};

// ---------- LaTeX rendering for display ----------
function toLatexTerm(t) {
  if (t.term === 'Var') return t.name;
  if (t.term === 'Func') return t.name + '(' + t.args.map(toLatexTerm).join(',') + ')';
  error('Termo desconhecido');
}
function atomToLatex(node) {
  if (node.kind === 'Pred') {
    return node.args.length ? `${node.name}(${node.args.map(toLatexTerm).join(',')})` : node.name;
  }
  if (node.kind === 'Not' && node.child.kind === 'Pred') {
    return `\\lnot ${atomToLatex(node.child)}`;
  }
  return `(${toLatex(node)})`;
}
function toLatex(node) {
  switch (node.kind) {
    case 'ForAll': return `\\forall ${node.variable}\\, (${toLatex(node.body)})`;
    case 'Exists': return `\\exists ${node.variable}\\, (${toLatex(node.body)})`;
    case 'Not': return `\\lnot ${atomToLatex(node.child)}`;
    case 'And': return `${atomToLatex(node.left)} \\land ${atomToLatex(node.right)}`;
    case 'Or': return `${atomToLatex(node.left)} \\lor ${atomToLatex(node.right)}`;
    case 'Implies': return `${atomToLatex(node.left)} \\to ${atomToLatex(node.right)}`;
    case 'Iff': return `${atomToLatex(node.left)} \\leftrightarrow ${atomToLatex(node.right)}`;
    case 'Pred': return node.args.length ? `${node.name}(${node.args.map(toLatexTerm).join(',')})` : node.name;
    default: error('Nó desconhecido: ' + node.kind);
  }
}

// ---------- Eliminate IFF/IMPLIES ----------
// Mid-step helpers to show elimination in two stages
function eliminateIffOnly(formula) {
  switch (formula.kind) {
    case 'Iff':
      // expand ↔ into (A→B) ∧ (B→A) but keep → intact
      return Node.And(
        eliminateIffOnly(Node.Implies(formula.left, formula.right)),
        eliminateIffOnly(Node.Implies(formula.right, formula.left))
      );
    case 'Not': return Node.Not(eliminateIffOnly(formula.child));
    case 'And': return Node.And(eliminateIffOnly(formula.left), eliminateIffOnly(formula.right));
    case 'Or': return Node.Or(eliminateIffOnly(formula.left), eliminateIffOnly(formula.right));
    case 'ForAll': return Node.ForAll(formula.variable, eliminateIffOnly(formula.body));
    case 'Exists': return Node.Exists(formula.variable, eliminateIffOnly(formula.body));
    default: return formula; // Pred or Implies stay as-is
  }
}
function eliminateImpOnly(formula) {
  switch (formula.kind) {
    case 'Implies':
      return eliminateImpOnly(Node.Or(Node.Not(formula.left), formula.right));
    case 'Not': return Node.Not(eliminateImpOnly(formula.child));
    case 'And': return Node.And(eliminateImpOnly(formula.left), eliminateImpOnly(formula.right));
    case 'Or': return Node.Or(eliminateImpOnly(formula.left), eliminateImpOnly(formula.right));
    case 'ForAll': return Node.ForAll(formula.variable, eliminateImpOnly(formula.body));
    case 'Exists': return Node.Exists(formula.variable, eliminateImpOnly(formula.body));
    default: return formula; // Pred
  }
}
function eliminateIffImp(formula) {
  switch (formula.kind) {
    case 'Iff':
      return Node.And(
        eliminateIffImp(Node.Implies(formula.left, formula.right)),
        eliminateIffImp(Node.Implies(formula.right, formula.left))
      );
    case 'Implies':
      return eliminateIffImp(Node.Or(Node.Not(formula.left), formula.right));
    case 'Not':
      return Node.Not(eliminateIffImp(formula.child));
    case 'And':
      return Node.And(eliminateIffImp(formula.left), eliminateIffImp(formula.right));
    case 'Or':
      return Node.Or(eliminateIffImp(formula.left), eliminateIffImp(formula.right));
    case 'ForAll':
      return Node.ForAll(formula.variable, eliminateIffImp(formula.body));
    case 'Exists':
      return Node.Exists(formula.variable, eliminateIffImp(formula.body));
    default:
      return formula;
  }
}

// ---------- NNF (push negations in) ----------
function toNNF(formula) {
  switch (formula.kind) {
    case 'Not': {
      const inner = formula.child;
      switch (inner.kind) {
        case 'Not': return toNNF(inner.child);
        case 'And': return Node.Or(toNNF(Node.Not(inner.left)), toNNF(Node.Not(inner.right)));
        case 'Or': return Node.And(toNNF(Node.Not(inner.left)), toNNF(Node.Not(inner.right)));
        case 'ForAll': return Node.Exists(inner.variable, toNNF(Node.Not(inner.body)));
        case 'Exists': return Node.ForAll(inner.variable, toNNF(Node.Not(inner.body)));
        case 'Pred': return Node.Not(inner);
        default: error('Forma inesperada em NNF: ' + inner.kind);
      }
    }
    case 'And': return Node.And(toNNF(formula.left), toNNF(formula.right));
    case 'Or': return Node.Or(toNNF(formula.left), toNNF(formula.right));
    case 'ForAll': return Node.ForAll(formula.variable, toNNF(formula.body));
    case 'Exists': return Node.Exists(formula.variable, toNNF(formula.body));
    default: return formula;
  }
}

// ---------- Variable collection & standardization ----------
function collectAllVarNames(f) {
  const names = new Set();
  function inTerm(t) {
    if (t.term === 'Var') { names.add(t.name); return; }
    t.args.forEach(inTerm);
  }
  function walk(n) {
    switch (n.kind) {
      case 'Pred': n.args.forEach(inTerm); break;
      case 'Not': walk(n.child); break;
      case 'And': walk(n.left); walk(n.right); break;
      case 'Or': walk(n.left); walk(n.right); break;
      case 'ForAll': names.add(n.variable); walk(n.body); break;
      case 'Exists': names.add(n.variable); walk(n.body); break;
    }
  }
  walk(f);
  return Array.from(names);
}
function standardizeVariables(formula) {
  const used = new Set(collectAllVarNames(formula));
  let counter = 1;
  function fresh(base) {
    let name = base;
    while (used.has(name)) { name = base + (counter++); }
    used.add(name);
    return name;
  }
  // substitute variable names inside terms/formulas
  function substVarInTerm(t, from, to) {
    if (t.term === 'Var') return (t.name === from) ? Term.Var(to) : t;
    return Term.Func(t.name, t.args.map(a => substVarInTerm(a, from, to)));
  }
  function substVarInFormula(g, from, to) {
    switch (g.kind) {
      case 'Pred': return Node.Pred(g.name, g.args.map(a => substVarInTerm(a, from, to)));
      case 'Not': return Node.Not(substVarInFormula(g.child, from, to));
      case 'And': return Node.And(substVarInFormula(g.left, from, to), substVarInFormula(g.right, from, to));
      case 'Or': return Node.Or(substVarInFormula(g.left, from, to), substVarInFormula(g.right, from, to));
      case 'ForAll': {
        if (g.variable === from) return g;
        return Node.ForAll(g.variable, substVarInFormula(g.body, from, to));
      }
      case 'Exists': {
        if (g.variable === from) return g;
        return Node.Exists(g.variable, substVarInFormula(g.body, from, to));
      }
      default: return g;
    }
  }
  function walk(g) {
    switch (g.kind) {
      case 'ForAll': {
        const newV = fresh('x');
        const renamedBody = substVarInFormula(g.body, g.variable, newV);
        return Node.ForAll(newV, walk(renamedBody));
      }
      case 'Exists': {
        const newV = fresh('x');
        const renamedBody = substVarInFormula(g.body, g.variable, newV);
        return Node.Exists(newV, walk(renamedBody));
      }
      case 'Not': return Node.Not(walk(g.child));
      case 'And': return Node.And(walk(g.left), walk(g.right));
      case 'Or': return Node.Or(walk(g.left), walk(g.right));
      default: return g;
    }
  }
  return walk(formula);
}

// ---------- Prenex (pull quantifiers to front) ----------
function toPrenex(formula) {
  switch (formula.kind) {
    case 'ForAll': {
      const r = toPrenex(formula.body);
      return { prefix: [{ q: 'forall', v: formula.variable }, ...r.prefix], matrix: r.matrix };
    }
    case 'Exists': {
      const r = toPrenex(formula.body);
      return { prefix: [{ q: 'exists', v: formula.variable }, ...r.prefix], matrix: r.matrix };
    }
    case 'And': {
      const L = toPrenex(formula.left), R = toPrenex(formula.right);
      return { prefix: [...L.prefix, ...R.prefix], matrix: Node.And(L.matrix, R.matrix) };
    }
    case 'Or': {
      const L = toPrenex(formula.left), R = toPrenex(formula.right);
      return { prefix: [...L.prefix, ...R.prefix], matrix: Node.Or(L.matrix, R.matrix) };
    }
    case 'Not': return { prefix: [], matrix: formula };
    case 'Pred': return { prefix: [], matrix: formula };
    default: error('Forma não-NNF em prenex: ' + formula.kind);
  }
}
function latexPrefix(prefix) {
  if (!prefix.length) return '';
  return prefix.map(p => (p.q === 'forall' ? `\\forall ${p.v}` : `\\exists ${p.v}`)).join(' ') + `\\, `;
}

// ---------- Substitution helper (replace variable with term everywhere, respecting quantifiers) ----------
function substVarAll(formula, from, term) {
  function inTerm(t) {
    if (t.term === 'Var') return (t.name === from) ? term : t;
    return Term.Func(t.name, t.args.map(inTerm));
  }
  function go(g) {
    switch (g.kind) {
      case 'Pred': return Node.Pred(g.name, g.args.map(inTerm));
      case 'Not': return Node.Not(go(g.child));
      case 'And': return Node.And(go(g.left), go(g.right));
      case 'Or': return Node.Or(go(g.left), go(g.right));
      case 'ForAll': {
        if (g.variable === from) return g;
        return Node.ForAll(g.variable, go(g.body));
      }
      case 'Exists': {
        if (g.variable === from) return g;
        return Node.Exists(g.variable, go(g.body));
      }
      default: return g;
    }
  }
  return go(formula);
}

// ---------- Skolemization ----------
function skolemize(prefix, matrix) {
  let current = deepClone(matrix);
  const universals = [];
  let fCount = 1, cCount = 1;
  for (const p of prefix) {
    if (p.q === 'forall') universals.push(p.v);
    else { // exists -> replace variable with Skolem term
      let sk;
      if (universals.length === 0) { sk = Term.Func('c' + (cCount++), []); }
      else { sk = Term.Func('f' + (fCount++), universals.map(u => Term.Var(u))); }
      current = substVarAll(current, p.v, sk);
    }
  }
  // drop all quantifiers
  function dropAllQuantifiers(g) {
    switch (g.kind) {
      case 'ForAll': return dropAllQuantifiers(g.body);
      case 'Exists': return dropAllQuantifiers(g.body);
      case 'Not': return Node.Not(dropAllQuantifiers(g.child));
      case 'And': return Node.And(dropAllQuantifiers(g.left), dropAllQuantifiers(g.right));
      case 'Or': return Node.Or(dropAllQuantifiers(g.left), dropAllQuantifiers(g.right));
      default: return g;
    }
  }
  return dropAllQuantifiers(current);
}

// ---------- Helpers for flattening/distribution ----------
function flatten(op, node) {
  // collect a list of nodes under repeated op
  function collect(n, acc) {
    if (n.kind === op) { collect(n.left, acc); collect(n.right, acc); }
    else acc.push(n);
  }
  const arr = []; collect(node, arr);
  // combine back into binary left-assoc chain (or single element)
  return arr.reduce((a,b) => a ? Node[op](a,b) : b, null);
}
function isAnd(n) { return n.kind === 'And'; }
function isOr(n) { return n.kind === 'Or'; }

// distribute OR over AND (for CNF)
function distributeOrOverAnd(n) {
  if (n.kind !== 'Or') return n;
  const A = n.left, B = n.right;
  if (isAnd(B)) {
    return Node.And(
      distributeOrOverAnd(Node.Or(A, B.left)),
      distributeOrOverAnd(Node.Or(A, B.right))
    );
  }
  if (isAnd(A)) {
    return Node.And(
      distributeOrOverAnd(Node.Or(A.left, B)),
      distributeOrOverAnd(Node.Or(A.right, B))
    );
  }
  return Node.Or(A, B);
}
function toCNFMatrix(n) {
  function step(x) {
    if (x.kind === 'And') return Node.And(step(x.left), step(x.right));
    if (x.kind === 'Or') return distributeOrOverAnd(Node.Or(step(x.left), step(x.right)));
    if (x.kind === 'Not' || x.kind === 'Pred') return x;
    error('Forma inesperada na matrix CNF: ' + x.kind);
  }
  let m = step(n);
  function fix(y) {
    if (y.kind === 'And') return flatten('And', Node.And(fix(y.left), fix(y.right)));
    if (y.kind === 'Or') return flatten('Or', Node.Or(fix(y.left), fix(y.right)));
    return y;
  }
  return fix(m);
}

// CNF with intermediate (pre/post flatten)
function toCNFMatrixWithIntermediate(n) {
  function step(x) {
    if (x.kind === 'And') return Node.And(step(x.left), step(x.right));
    if (x.kind === 'Or') return distributeOrOverAnd(Node.Or(step(x.left), step(x.right)));
    if (x.kind === 'Not' || x.kind === 'Pred') return x;
    error('Forma inesperada na matrix CNF: ' + x.kind);
  }
  const raw = step(n);
  function fix(y) {
    if (y.kind === 'And') return flatten('And', Node.And(fix(y.left), fix(y.right)));
    if (y.kind === 'Or') return flatten('Or', Node.Or(fix(y.left), fix(y.right)));
    return y;
  }
  const flat = fix(raw);
  return { raw, flat };
}

// distribute AND over OR (for DNF)
function distributeAndOverOr(n) {
  if (n.kind !== 'And') return n;
  const A = n.left, B = n.right;
  if (isOr(B)) {
    return Node.Or(
      distributeAndOverOr(Node.And(A, B.left)),
      distributeAndOverOr(Node.And(A, B.right))
    );
  }
  if (isOr(A)) {
    return Node.Or(
      distributeAndOverOr(Node.And(A.left, B)),
      distributeAndOverOr(Node.And(A.right, B))
    );
  }
  return Node.And(A,B);
}
function toDNFMatrix(n) {
  function step(x) {
    if (x.kind === 'Or') return Node.Or(step(x.left), step(x.right));
    if (x.kind === 'And') return distributeAndOverOr(Node.And(step(x.left), step(x.right)));
    if (x.kind === 'Not' || x.kind === 'Pred') return x;
    error('Forma inesperada na matrix DNF: ' + x.kind);
  }
  let m = step(n);
  function fix(y) {
    if (y.kind === 'And') return flatten('And', Node.And(fix(y.left), fix(y.right)));
    if (y.kind === 'Or') return flatten('Or', Node.Or(fix(y.left), fix(y.right)));
    return y;
  }
  return fix(m);
}

// DNF with intermediate (pre/post flatten)
function toDNFMatrixWithIntermediate(n) {
  function step(x) {
    if (x.kind === 'Or') return Node.Or(step(x.left), step(x.right));
    if (x.kind === 'And') return distributeAndOverOr(Node.And(step(x.left), step(x.right)));
    if (x.kind === 'Not' || x.kind === 'Pred') return x;
    error('Forma inesperada na matrix DNF: ' + x.kind);
  }
  const raw = step(n);
  function fix(y) {
    if (y.kind === 'And') return flatten('And', Node.And(fix(y.left), fix(y.right)));
    if (y.kind === 'Or') return flatten('Or', Node.Or(fix(y.left), fix(y.right)));
    return y;
  }
  const flat = fix(raw);
  return { raw, flat };
}

// ---------- CNF -> clauses (array of clause arrays of {neg, pred}) ----------
function cnfToClauses(n) {
  function collectClauses(x) {
    if (x.kind === 'And') return [...collectClauses(x.left), ...collectClauses(x.right)];
    return [x];
  }
  function collectLits(x) {
    if (x.kind === 'Or') return [...collectLits(x.left), ...collectLits(x.right)];
    if (x.kind === 'Not' && x.child.kind === 'Pred') return [{ neg: true, pred: x.child }];
    if (x.kind === 'Pred') return [{ neg: false, pred: x }];
    error('Literal inválido na CNF');
  }
  return collectClauses(n).map(collectLits);
}
function latexClause(lits) {
  const items = lits.map(L => L.neg ? `\\lnot ${toLatex(L.pred)}` : toLatex(L.pred));
  return `\\{ ${items.join(', \\; ')} \\}`;
}

// ---------- UI & Wiring (same as original, simplified helper usage) ----------
const inputEl = document.getElementById('input');
const previewEl = document.getElementById('preview');
const stepsEl = document.getElementById('steps');
const errorEl = document.getElementById('error');
const statusEl = document.getElementById('status');

document.querySelectorAll('.chip').forEach(b => {
  b.addEventListener('click', () => {
    inputEl.value = b.getAttribute('data-example');
    recompute();
  });
});
function autoResizeTextarea(el) {
  if (!el) return;
  el.style.height = 'auto';
  const newH = Math.min(el.scrollHeight, window.innerHeight * 0.6);
  el.style.height = newH + 'px';
}
inputEl.addEventListener('input', () => { autoResizeTextarea(inputEl); recompute(); });

function renderMath(el) {
  if (window.MathJax && window.MathJax.typesetPromise) {
    MathJax.typesetPromise([el]).catch(() => {});
  }
}
function setPreview(tex) {
  previewEl.innerHTML = tex ? `$$${tex}$$` : '&nbsp;';
  renderMath(previewEl);
}
function addStep(title, tex, extraHtml='') {
  const box = document.createElement('details');
  box.open = true; // colapsável, mas abre por padrão
  box.className = 'step-card';
  const heading = document.createElement('summary');
  heading.className = 'step-title';
  heading.textContent = title;
  const content = document.createElement('div');
  content.className = 'step-content';
  content.innerHTML = (tex ? `$$${tex}$$` : '') + (extraHtml ? `<div style="margin-top:6px">${extraHtml}</div>` : '');
  box.appendChild(heading);
  box.appendChild(content);
  stepsEl.appendChild(box);
  renderMath(content);
}

// Helpers to show mid-steps
function tokensToHtml(tokens) {
  const parts = tokens.map(t => {
    if (t.type === 'name') return t.value;
    return t.value;
  });
  return `<div class="mono" style="white-space: pre-wrap;">${parts.join(' ')}</div>`;
}

function standardizeVariablesWithMap(formula) {
  const used = new Set(collectAllVarNames(formula));
  let counter = 1;
  const mapping = [];
  function fresh(base) {
    let name = base;
    while (used.has(name)) { name = base + (counter++); }
    used.add(name);
    return name;
  }
  function substVarInTerm(t, from, to) {
    if (t.term === 'Var') return (t.name === from) ? Term.Var(to) : t;
    return Term.Func(t.name, t.args.map(a => substVarInTerm(a, from, to)));
  }
  function substVarInFormula(g, from, to) {
    switch (g.kind) {
      case 'Pred': return Node.Pred(g.name, g.args.map(a => substVarInTerm(a, from, to)));
      case 'Not': return Node.Not(substVarInFormula(g.child, from, to));
      case 'And': return Node.And(substVarInFormula(g.left, from, to), substVarInFormula(g.right, from, to));
      case 'Or': return Node.Or(substVarInFormula(g.left, from, to), substVarInFormula(g.right, from, to));
      case 'ForAll': {
        if (g.variable === from) return g;
        return Node.ForAll(g.variable, substVarInFormula(g.body, from, to));
      }
      case 'Exists': {
        if (g.variable === from) return g;
        return Node.Exists(g.variable, substVarInFormula(g.body, from, to));
      }
      default: return g;
    }
  }
  function walk(g) {
    switch (g.kind) {
      case 'ForAll': {
        const oldV = g.variable; const newV = fresh('x');
        mapping.push(`${oldV} → ${newV}`);
        const renamedBody = substVarInFormula(g.body, oldV, newV);
        return Node.ForAll(newV, walk(renamedBody));
      }
      case 'Exists': {
        const oldV = g.variable; const newV = fresh('x');
        mapping.push(`${oldV} → ${newV}`);
        const renamedBody = substVarInFormula(g.body, oldV, newV);
        return Node.Exists(newV, walk(renamedBody));
      }
      case 'Not': return Node.Not(walk(g.child));
      case 'And': return Node.And(walk(g.left), walk(g.right));
      case 'Or': return Node.Or(walk(g.left), walk(g.right));
      default: return g;
    }
  }
  const standardized = walk(formula);
  return { formula: standardized, mapping };
}

function skolemizeWithMap(prefix, matrix) {
  let current = deepClone(matrix);
  const universals = [];
  let fCount = 1, cCount = 1;
  const mapping = [];
  for (const p of prefix) {
    if (p.q === 'forall') universals.push(p.v);
    else {
      let sk;
      if (universals.length === 0) { sk = Term.Func('c' + (cCount++), []); }
      else { sk = Term.Func('f' + (fCount++), universals.map(u => Term.Var(u))); }
      mapping.push(`${p.v} → ${toLatexTerm(sk)}`);
      current = substVarAll(current, p.v, sk);
    }
  }
  function dropAllQuantifiers(g) {
    switch (g.kind) {
      case 'ForAll': return dropAllQuantifiers(g.body);
      case 'Exists': return dropAllQuantifiers(g.body);
      case 'Not': return Node.Not(dropAllQuantifiers(g.child));
      case 'And': return Node.And(dropAllQuantifiers(g.left), dropAllQuantifiers(g.right));
      case 'Or': return Node.Or(dropAllQuantifiers(g.left), dropAllQuantifiers(g.right));
      default: return g;
    }
  }
  const result = dropAllQuantifiers(current);
  return { matrix: result, mapping };
}

// ---------- Main pipeline: recompute ----------
function recompute() {
  const raw = (inputEl.value || '').trim();
  const normalized = normalizeInput(raw);
  setPreview(normalized ? normalized : '');
  stepsEl.innerHTML = '';
  errorEl.textContent = '';
  if (statusEl) statusEl.textContent = '';
  if (!normalized) return;

  try {
    const tokens = tokenize(normalized);
    const parser = new Parser(tokens);
    const original = parser.parse();

    addStep('1) Original (normalizado)', toLatex(original));
    // 1a) tokens
    addStep('1.1) Tokens (após normalização)', '', tokensToHtml(tokens));

    // 2) eliminate ↔ only
    const noIff = eliminateIffOnly(deepClone(original));
    addStep('2) Sem ↔ (somente ↔ expandido)', toLatex(noIff));
    // 3) eliminate → only
    const noImp = eliminateImpOnly(deepClone(noIff));
    addStep('3) Sem → (somente → eliminado)', toLatex(noImp));

    // 4) NNF
    const nnf = toNNF(deepClone(noImp));
    addStep('4) NNF (negações para dentro)', toLatex(nnf));

    // 5) standardize variables (unique) + mapping
    const stdInfo = standardizeVariablesWithMap(deepClone(nnf));
    const std = stdInfo.formula;
    const mappingHtml = stdInfo.mapping.length ? `<div class="mono">Renomeações: ${stdInfo.mapping.join(', ')}</div>` : '';
    addStep('5) Variáveis padronizadas (únicas)', toLatex(std), mappingHtml);

    // 6) prenex
    const pren = toPrenex(deepClone(std));
    const prenTex = `${latexPrefix(pren.prefix)}(${toLatex(pren.matrix)})`;
    addStep('6) Prenex (quantificadores no prefixo)', prenTex);

    // 7) prenex CNF (matrix converted) with intermediate
    const cnfRes = toCNFMatrixWithIntermediate(deepClone(pren.matrix));
    const cnfTexRaw = `${latexPrefix(pren.prefix)}(${toLatex(cnfRes.raw)})`;
    addStep('7) Prenex CNF (pré-flatten: distribuição bruta)', cnfTexRaw);
    const cnfMatrix = cnfRes.flat;
    const cnfTex = `${latexPrefix(pren.prefix)}(${toLatex(cnfMatrix)})`;
    addStep('7.1) Prenex CNF (após flatten)', cnfTex);

    // 8) prenex DNF (matrix converted) with intermediate
    const dnfRes = toDNFMatrixWithIntermediate(deepClone(pren.matrix));
    const dnfTexRaw = `${latexPrefix(pren.prefix)}(${toLatex(dnfRes.raw)})`;
    addStep('8) Prenex DNF (pré-flatten: distribuição bruta)', dnfTexRaw);
    const dnfMatrix = dnfRes.flat;
    const dnfTex = `${latexPrefix(pren.prefix)}(${toLatex(dnfMatrix)})`;
    addStep('8.1) Prenex DNF (após flatten)', dnfTex);

    // 9) Skolemize + clauses (with mapping)
    const skRes = skolemizeWithMap(pren.prefix, deepClone(cnfMatrix));
    const skoMatrix = skRes.matrix;
    const skoClauses = cnfToClauses(skoMatrix);
    const clauseLatex = skoClauses.map(latexClause).join(' \\land ');
    // horn check: pos literals count <= 1
    const hornInfo = skoClauses.map((cls, idx) => {
      const pos = cls.filter(L => !L.neg).length;
      const isHorn = pos <= 1;
      return `<div>Cláusula ${idx+1}: ${isHorn ? '<span class="ok">Horn</span>' : '<span class="error">não-Horn</span>'} (positivos=${pos})</div>`;
    }).join('');
    const allHorn = skoClauses.every(cls => cls.filter(L => !L.neg).length <= 1);
    const allHornHtml = `<div style="margin-top:6px"><strong>Conjunto Horn?</strong> ${allHorn ? '<span class="ok">Sim</span>' : '<span class="error">Não</span>'}</div>`;
    const skMapHtml = skRes.mapping.length ? `<div class="mono" style="margin-top:6px">Skolem: ${skRes.mapping.join(', ')}</div>` : '';
    addStep('9) Skolemização + Forma Cláusal (implícita ∀)', toLatex(skoMatrix),
      `${skMapHtml}<div><strong>Cláusulas:</strong> $$${clauseLatex}$$</div>${hornInfo}${allHornHtml}`);

    // 10) Resumo final (compacto)
    const originalTex = toLatex(original);
    const noIffTex = toLatex(noIff);
    const noImpTex = toLatex(noImp);
    const nnfTex = toLatex(nnf);
    const stdTex = toLatex(std);
    const skoTex = toLatex(skoMatrix);
    const summaryHtml = [
      `<div><strong>Original:</strong> $$${originalTex}$$</div>`,
      `<div><strong>Sem ↔:</strong> $$${noIffTex}$$</div>`,
      `<div><strong>Sem →:</strong> $$${noImpTex}$$</div>`,
      `<div><strong>NNF:</strong> $$${nnfTex}$$</div>`,
      `<div><strong>Variáveis padronizadas:</strong> $$${stdTex}$$</div>`,
      `<div><strong>Prenex:</strong> $$${prenTex}$$</div>`,
      `<div><strong>Prenex CNF:</strong> $$${cnfTex}$$</div>`,
      `<div><strong>Prenex DNF:</strong> $$${dnfTex}$$</div>`,
      `<div><strong>Skolem (∀ implícito):</strong> $$${skoTex}$$</div>`,
      `<div><strong>Cláusulas:</strong> $$${clauseLatex}$$</div>`,
      allHornHtml
    ].join('');
    addStep('10) Resumo (principais resultados)', '', summaryHtml);
    if (statusEl) statusEl.textContent = 'Concluído.';

  } catch (e) {
    errorEl.textContent = (e && e.message) ? e.message : String(e);
    if (statusEl) statusEl.textContent = 'Erro.';
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('input');
  if (input) {
    input.value = '\\forall x (P(x) \\to \\exists y\\, Q(x,y))';
    autoResizeTextarea(input);
    recompute();
  }
  // Controls: expand/collapse/copy summary
  const expandAllBtn = document.getElementById('expand-all');
  const collapseAllBtn = document.getElementById('collapse-all');
  const copySummaryBtn = document.getElementById('copy-summary');
  function allDetails() { return Array.from(document.querySelectorAll('#steps details')); }
  if (expandAllBtn) expandAllBtn.addEventListener('click', () => { allDetails().forEach(d => d.open = true); });
  if (collapseAllBtn) collapseAllBtn.addEventListener('click', () => { allDetails().forEach(d => d.open = false); });
  if (copySummaryBtn) copySummaryBtn.addEventListener('click', async () => {
    const last = Array.from(document.querySelectorAll('#steps details .step-title')).find(el => el.textContent && el.textContent.includes('Resumo'));
    const summaryBox = last ? last.parentElement : null;
    const text = summaryBox ? summaryBox.innerText : '';
    try {
      await navigator.clipboard.writeText(text);
      if (statusEl) statusEl.textContent = 'Resumo copiado.';
    } catch (_) { if (statusEl) statusEl.textContent = 'Não foi possível copiar.'; }
  });
});
