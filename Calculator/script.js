/**
 * ═══════════════════════════════════════════════════════════
 * CALCPRO — script.js
 * Premium Calculator — Vanilla ES6+ JavaScript
 * Features: Standard & Scientific modes, Memory, History,
 *           Keyboard support, Theme persistence, Ripple FX,
 *           Toast notifications, Copy to clipboard, Accessibility
 * ═══════════════════════════════════════════════════════════
 */

"use strict";

/* ═══════════════════════════════════════════════════════════
   MODULE 1 — STATE
   Single source of truth for all calculator state.
═══════════════════════════════════════════════════════════ */
const State = (() => {
  const data = {
    expression:    "",      // Full expression string being built
    display:       "0",     // What's shown in the main display
    lastResult:    null,    // Last evaluated result
    waitingForOperand: false, // True right after operator or = press
    isError:       false,   // Error flag
    memory:        0,       // Memory register
    hasMemory:     false,   // Whether memory holds a value
    history:       [],      // Array of { expr, result, time }
    isScientific:  false,   // Scientific mode toggle
    isHistoryOpen: false,   // History panel toggle
    justEvaluated: false,   // True immediately after = press
    pendingPower:  false,   // Waiting for exponent in xʸ
  };

  return {
    get: (key) => data[key],
    set: (key, val) => { data[key] = val; },
    reset: () => {
      data.expression       = "";
      data.display          = "0";
      data.lastResult       = null;
      data.waitingForOperand = false;
      data.isError          = false;
      data.justEvaluated    = false;
      data.pendingPower     = false;
    },
  };
})();

/* ═══════════════════════════════════════════════════════════
   MODULE 2 — DOM REFS
   Cache every DOM element once for performance.
═══════════════════════════════════════════════════════════ */
const DOM = (() => {
  const $ = (id) => document.getElementById(id);
  const $$ = (sel) => document.querySelectorAll(sel);

  return {
    loadingScreen:    $("loadingScreen"),
    app:              $("app"),
    themeToggleBtn:   $("themeToggleBtn"),
    themeIcon:        $("themeIcon"),
    sciToggleBtn:     $("sciToggleBtn"),
    historyToggleBtn: $("historyToggleBtn"),
    historyPanel:     $("historyPanel"),
    historyList:      $("historyList"),
    historyEmpty:     $("historyEmpty"),
    historyClearBtn:  $("historyClearBtn"),
    mainDisplay:      $("mainDisplay"),
    expressionDisplay: $("expressionDisplay"),
    memIndicator:     $("memIndicator"),
    modeIndicator:    $("modeIndicator"),
    copyBtn:          $("copyBtn"),
    sciRow:           $("sciRow"),
    memoryRow:        $("memoryRow"),
    keypad:           $("keypad"),
    toastContainer:   $("toastContainer"),
    allBtns:          () => $$(".btn"),
  };
})();

/* ═══════════════════════════════════════════════════════════
   MODULE 3 — DISPLAY
   All rendering logic — keeps UI concerns isolated.
═══════════════════════════════════════════════════════════ */
const Display = (() => {

  /** Format a number for display — handle float precision */
  const formatNumber = (num) => {
    if (typeof num !== "number" || isNaN(num)) return "Error";
    if (!isFinite(num)) return num > 0 ? "∞" : "-∞";

    // If it's an integer and not too large, show as-is
    if (Number.isInteger(num) && Math.abs(num) < 1e15) {
      return num.toLocaleString("en-US", { maximumFractionDigits: 0 });
    }

    // Float — cap to 10 significant digits to avoid floating point noise
    const str = parseFloat(num.toPrecision(10)).toString();
    return str;
  };

  /** Adjust font size based on string length */
  const adjustFontSize = (text) => {
    const el = DOM.mainDisplay;
    el.classList.remove("shrink-1", "shrink-2", "shrink-3");
    const len = text.toString().length;
    if (len > 16) el.classList.add("shrink-3");
    else if (len > 12) el.classList.add("shrink-2");
    else if (len > 9)  el.classList.add("shrink-1");
  };

  return {
    /** Set the main number display */
    setMain: (value, isResult = false, isError = false) => {
      const el = DOM.mainDisplay;
      const text = isError
        ? (typeof value === "string" ? value : "Error")
        : formatNumber(typeof value === "string" ? parseFloat(value) || value : value);

      el.textContent = text;
      el.classList.toggle("error-state", isError);
      el.classList.toggle("result-state", isResult && !isError);
      adjustFontSize(text);
    },

    /** Set the small expression line above the main display */
    setExpression: (expr) => {
      DOM.expressionDisplay.textContent = expr || "\u00A0";
    },

    /** Update memory indicator badge */
    updateMemoryBadge: (hasMemory) => {
      if (hasMemory) {
        DOM.memIndicator.removeAttribute("hidden");
      } else {
        DOM.memIndicator.setAttribute("hidden", "");
      }
    },

    /** Flash a highlight animation on the display */
    flashDisplay: () => {
      const el = DOM.mainDisplay;
      el.style.transition = "none";
      el.style.opacity = "0.5";
      requestAnimationFrame(() => {
        el.style.transition = "opacity 0.2s ease";
        el.style.opacity    = "1";
      });
    },

    /** Show raw string on main display (for live input) */
    setRaw: (str) => {
      const el = DOM.mainDisplay;
      el.textContent = str || "0";
      el.classList.remove("error-state", "result-state");
      adjustFontSize(str || "0");
    },
  };
})();

/* ═══════════════════════════════════════════════════════════
   MODULE 4 — MATH ENGINE
   Pure computation — no DOM or side effects.
═══════════════════════════════════════════════════════════ */
const MathEngine = (() => {

  /** Map display symbols to JS operators */
  const OP_MAP = {
    "×": "*",
    "÷": "/",
    "−": "-",
    "+": "+",
    "%": "%",
  };

  /**
   * Safely evaluate a mathematical expression string.
   * We build a clean JS-compatible string and use Function()
   * with explicit whitelist — no direct eval on raw input.
   */
  const evaluate = (expr) => {
    // Replace display symbols with JS operators
    let jsExpr = expr;
    for (const [display, js] of Object.entries(OP_MAP)) {
      jsExpr = jsExpr.replaceAll(display, js);
    }

    // Replace π with its value
    jsExpr = jsExpr.replace(/π/g, Math.PI.toString());

    // Validate: only allow digits, operators, parens, dot, space, e for scientific notation
    if (!/^[0-9+\-*/.()%eE\s]+$/.test(jsExpr)) {
      throw new Error("Invalid expression");
    }

    // Use Function constructor (safer than eval — explicit scope)
    // eslint-disable-next-line no-new-func
    const result = new Function(`"use strict"; return (${jsExpr});`)();

    if (typeof result !== "number") throw new Error("Invalid result");
    return result;
  };

  return {
    /** Main evaluation entry point */
    compute: (expr) => {
      if (!expr || expr.trim() === "") return null;

      try {
        const result = evaluate(expr.trim());

        if (!isFinite(result)) {
          if (result === Infinity || result === -Infinity) return result;
          throw new Error("Division by zero");
        }
        if (isNaN(result)) throw new Error("Invalid expression");

        return result;
      } catch (e) {
        // Return a typed error so callers can display it meaningfully
        const msg = e.message.includes("Division") ? "Cannot divide by 0"
                  : e.message.includes("Invalid")  ? "Syntax error"
                  : "Error";
        throw new TypeError(msg);
      }
    },

    /** Scientific functions — take current display value */
    applyScientific: (fn, value) => {
      const n = parseFloat(value);
      if (isNaN(n)) throw new TypeError("Invalid input");

      switch (fn) {
        case "sin":    return Math.sin((n * Math.PI) / 180);   // degrees
        case "cos":    return Math.cos((n * Math.PI) / 180);
        case "tan":    return Math.tan((n * Math.PI) / 180);
        case "log":    if (n <= 0) throw new TypeError("log(x): x must be > 0");
                       return Math.log10(n);
        case "ln":     if (n <= 0) throw new TypeError("ln(x): x must be > 0");
                       return Math.log(n);
        case "sqrt":   if (n < 0) throw new TypeError("√ of negative number");
                       return Math.sqrt(n);
        case "square": return n * n;
        case "pi":     return Math.PI;
        default:       throw new TypeError("Unknown function: " + fn);
      }
    },

    /** Percentage of current display relative to expression context */
    applyPercent: (n) => n / 100,

    /** Toggle sign */
    toggleSign: (n) => -n,

    format: {
      /** Round to avoid floating point display noise */
      clean: (n) => {
        if (!isFinite(n) || isNaN(n)) return n;
        return parseFloat(n.toPrecision(12));
      },
    },
  };
})();

/* ═══════════════════════════════════════════════════════════
   MODULE 5 — HISTORY
   Manage, persist, and render the history log.
═══════════════════════════════════════════════════════════ */
const History = (() => {

  const STORAGE_KEY = "calcpro-history";
  const MAX_ITEMS   = 50;

  /** Load history from localStorage */
  const load = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  };

  /** Save history to localStorage */
  const save = (items) => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); }
    catch { /* Storage unavailable — silently ignore */ }
  };

  /** Format a timestamp to HH:MM */
  const formatTime = (ts) => {
    const d = new Date(ts);
    return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  };

  /** Render a single history item into the list */
  const renderItem = (item, list) => {
    const el = document.createElement("div");
    el.className = "history-item";
    el.setAttribute("role", "listitem");
    el.setAttribute("tabindex", "0");
    el.setAttribute("title", "Click to restore this result");

    el.innerHTML = `
      <div class="history-expr">${escapeHTML(item.expr)}</div>
      <div class="history-result">= ${escapeHTML(String(item.result))}</div>
      <div class="history-time">${formatTime(item.time)}</div>
    `;

    // Click to recall result
    el.addEventListener("click", () => {
      Calculator.recallHistory(item.result);
    });

    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        Calculator.recallHistory(item.result);
      }
    });

    list.prepend(el);
  };

  /** Escape HTML to prevent XSS in history entries */
  const escapeHTML = (str) =>
    str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  return {
    init: () => {
      State.set("history", load());
      History.renderAll();
    },

    add: (expr, result) => {
      const items = State.get("history");
      const entry = { expr, result, time: Date.now() };
      items.unshift(entry);
      if (items.length > MAX_ITEMS) items.pop();
      State.set("history", items);
      save(items);
      History.renderAll();
    },

    clear: () => {
      State.set("history", []);
      save([]);
      History.renderAll();
      Toast.show("History cleared", "info");
    },

    renderAll: () => {
      const items = State.get("history");
      const list  = DOM.historyList;

      // Clear existing rendered items (keep empty state el)
      list.querySelectorAll(".history-item").forEach(el => el.remove());

      if (items.length === 0) {
        DOM.historyEmpty.style.display = "";
        return;
      }

      DOM.historyEmpty.style.display = "none";
      // Render newest-first (items already sorted by insertion order)
      items.forEach(item => renderItem(item, list));
    },
  };
})();

/* ═══════════════════════════════════════════════════════════
   MODULE 6 — THEME
   Dark / light toggle with localStorage persistence.
═══════════════════════════════════════════════════════════ */
const Theme = (() => {
  const KEY = "calcpro-theme";

  const apply = (theme) => {
    document.documentElement.setAttribute("data-theme", theme);
    DOM.themeIcon.textContent = theme === "dark" ? "☀" : "☾";
    try { localStorage.setItem(KEY, theme); } catch {}
  };

  return {
    init: () => {
      const saved = (() => { try { return localStorage.getItem(KEY); } catch { return null; } })();
      // Respect OS preference if no saved preference
      const preferred = saved || (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
      apply(preferred);
    },

    toggle: () => {
      const current = document.documentElement.getAttribute("data-theme");
      apply(current === "dark" ? "light" : "dark");
    },
  };
})();

/* ═══════════════════════════════════════════════════════════
   MODULE 7 — TOAST NOTIFICATIONS
═══════════════════════════════════════════════════════════ */
const Toast = (() => {

  const ICONS = { success: "✓", error: "✕", info: "ℹ" };
  const DURATION = 2800;

  return {
    show: (message, type = "info") => {
      const toast = document.createElement("div");
      toast.className = `toast ${type}`;
      toast.setAttribute("role", "alert");
      toast.innerHTML = `
        <span class="toast-icon" aria-hidden="true">${ICONS[type] || ICONS.info}</span>
        <span>${message}</span>
      `;

      DOM.toastContainer.appendChild(toast);

      // Auto-remove
      const remove = () => {
        toast.classList.add("toast-out");
        toast.addEventListener("animationend", () => toast.remove(), { once: true });
      };

      const timer = setTimeout(remove, DURATION);

      // Click to dismiss
      toast.addEventListener("click", () => {
        clearTimeout(timer);
        remove();
      });
    },
  };
})();

/* ═══════════════════════════════════════════════════════════
   MODULE 8 — RIPPLE EFFECT
   Inject ripple element on button click.
═══════════════════════════════════════════════════════════ */
const Ripple = (() => ({
  create: (btn, event) => {
    // Remove any existing ripple
    btn.querySelectorAll(".ripple").forEach(r => r.remove());

    const rect   = btn.getBoundingClientRect();
    const size   = Math.max(rect.width, rect.height);
    const x      = (event.clientX - rect.left) - size / 2;
    const y      = (event.clientY - rect.top)  - size / 2;

    const ripple = document.createElement("span");
    ripple.className = "ripple";
    Object.assign(ripple.style, {
      width:  `${size}px`,
      height: `${size}px`,
      left:   `${x}px`,
      top:    `${y}px`,
    });

    btn.appendChild(ripple);
    ripple.addEventListener("animationend", () => ripple.remove(), { once: true });
  },
}))();

/* ═══════════════════════════════════════════════════════════
   MODULE 9 — MEMORY FUNCTIONS
═══════════════════════════════════════════════════════════ */
const Memory = (() => {

  const update = () => {
    Display.updateMemoryBadge(State.get("hasMemory"));
  };

  return {
    clear: () => {
      State.set("memory", 0);
      State.set("hasMemory", false);
      update();
      Toast.show("Memory cleared", "info");
    },

    recall: () => {
      if (!State.get("hasMemory")) { Toast.show("Memory is empty", "info"); return; }
      const val = State.get("memory");
      State.set("display", String(val));
      State.set("justEvaluated", true);
      State.set("expression", "");
      Display.setRaw(String(val));
      Display.setExpression("MR");
    },

    add: () => {
      const cur = parseFloat(State.get("display"));
      if (isNaN(cur)) return;
      State.set("memory", (State.get("memory") || 0) + cur);
      State.set("hasMemory", true);
      update();
      Toast.show(`M+ = ${State.get("memory")}`, "success");
    },

    subtract: () => {
      const cur = parseFloat(State.get("display"));
      if (isNaN(cur)) return;
      State.set("memory", (State.get("memory") || 0) - cur);
      State.set("hasMemory", true);
      update();
      Toast.show(`M− = ${State.get("memory")}`, "info");
    },

    store: () => {
      const cur = parseFloat(State.get("display"));
      if (isNaN(cur)) return;
      State.set("memory", cur);
      State.set("hasMemory", true);
      update();
      Toast.show(`MS = ${cur}`, "success");
    },
  };
})();

/* ═══════════════════════════════════════════════════════════
   MODULE 10 — CLIPBOARD
═══════════════════════════════════════════════════════════ */
const Clipboard = (() => ({
  copy: async (text) => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback for non-HTTPS / older browsers
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.cssText = "position:fixed;top:-999px;left:-999px;opacity:0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
      Toast.show("Copied to clipboard!", "success");
    } catch {
      Toast.show("Could not copy", "error");
    }
  },
}))();

/* ═══════════════════════════════════════════════════════════
   MODULE 11 — CALCULATOR CORE
   Handles all button actions and expression building.
═══════════════════════════════════════════════════════════ */
const Calculator = (() => {

  const OPERATORS = new Set(["+", "−", "×", "÷"]);

  /** The raw expression string shown in small text */
  let liveExpr = "";

  /* ─── Input a digit or decimal point ─── */
  const inputDigit = (digit) => {
    if (State.get("isError")) return;

    let display = State.get("display");

    // After evaluation, a new digit starts fresh
    if (State.get("justEvaluated")) {
      display = digit;
      liveExpr = digit;
      State.set("justEvaluated", false);
      State.set("expression", digit);
    }
    // Waiting for operand (after an operator)
    else if (State.get("waitingForOperand")) {
      display = digit;
      liveExpr += digit;
      State.set("waitingForOperand", false);
      State.set("expression", State.get("expression") + digit);
    }
    // Limit digit count to 16
    else if (display.replace(".", "").replace("-", "").length >= 16) {
      return;
    }
    else {
      display = display === "0" ? digit : display + digit;
      liveExpr = State.get("expression") === "" ? digit : State.get("expression") + (display.endsWith(digit) ? "" : digit);
      State.set("expression", State.get("expression") === "0" ? digit : State.get("expression") + digit);
    }

    State.set("display", display);
    Display.setRaw(display);
    Display.setExpression(State.get("expression"));
  };

  /* ─── Input a decimal point ─── */
  const inputDecimal = () => {
    if (State.get("isError")) return;

    let display = State.get("display");

    if (State.get("justEvaluated") || State.get("waitingForOperand")) {
      display = "0.";
      State.set("justEvaluated", false);
      State.set("waitingForOperand", false);
    } else if (display.includes(".")) {
      return; // Already has a decimal
    } else {
      display = display + ".";
    }

    State.set("display", display);
    State.set("expression", State.get("expression") + (State.get("expression") === "" ? "0." : "."));
    Display.setRaw(display);
    Display.setExpression(State.get("expression"));
  };

  /* ─── Input an operator ─── */
  const inputOperator = (op) => {
    if (State.get("isError")) return;

    let expr = State.get("expression");

    // Replace trailing operator if user changed their mind
    if (expr.length > 0 && OPERATORS.has(expr.slice(-1))) {
      expr = expr.slice(0, -1) + op;
    } else {
      // If we have a result, continue from it
      if (State.get("justEvaluated") && State.get("lastResult") !== null) {
        expr = String(State.get("lastResult")) + op;
      } else {
        expr = (expr || State.get("display")) + op;
      }
    }

    State.set("expression", expr);
    State.set("waitingForOperand", true);
    State.set("justEvaluated", false);

    Display.setExpression(expr);
  };

  /* ─── Parentheses ─── */
  const inputParen = (paren) => {
    if (State.get("isError")) return;
    let expr = State.get("expression");

    if (State.get("justEvaluated")) {
      expr = paren === "(" ? paren : "";
      State.set("justEvaluated", false);
    } else {
      expr += paren;
    }

    State.set("expression", expr);
    State.set("waitingForOperand", paren === "(");
    Display.setExpression(expr);
    Display.setRaw(expr || "0");
    State.set("display", expr);
  };

  /* ─── Evaluate (=) ─── */
  const evaluate = () => {
    if (State.get("isError")) { allClear(); return; }

    let expr = State.get("expression");
    if (!expr) return;

    // Remove trailing operator
    while (expr.length > 0 && OPERATORS.has(expr.slice(-1))) {
      expr = expr.slice(0, -1);
    }

    // Record full expression before result
    const originalExpr = expr;

    try {
      const result = MathEngine.compute(expr);
      const clean  = MathEngine.format.clean(result);

      // Add to history
      History.add(originalExpr + " =", clean);

      Display.setMain(clean, true, false);
      Display.setExpression(originalExpr + " =");
      Display.flashDisplay();

      State.set("lastResult", clean);
      State.set("display", String(clean));
      State.set("expression", "");
      State.set("justEvaluated", true);
      State.set("waitingForOperand", false);
      State.set("isError", false);

    } catch (err) {
      Display.setMain(err.message, false, true);
      Display.setExpression(originalExpr);
      State.set("isError", true);
      State.set("justEvaluated", false);
      Toast.show(err.message, "error");
    }
  };

  /* ─── All Clear (AC) ─── */
  const allClear = () => {
    State.reset();
    Display.setRaw("0");
    Display.setExpression("");
    DOM.mainDisplay.classList.remove("error-state", "result-state");
  };

  /* ─── Backspace ─── */
  const backspace = () => {
    if (State.get("isError"))  { allClear(); return; }
    if (State.get("justEvaluated")) return;

    const expr = State.get("expression");
    if (!expr) return;

    const newExpr = expr.slice(0, -1);
    const lastChar = newExpr.slice(-1);

    State.set("expression", newExpr);
    State.set("waitingForOperand", OPERATORS.has(lastChar));

    const displayVal = newExpr || "0";
    State.set("display", displayVal);
    Display.setRaw(displayVal);
    Display.setExpression(newExpr);
  };

  /* ─── Toggle Sign (+/−) ─── */
  const toggleSign = () => {
    if (State.get("isError")) return;
    const n = parseFloat(State.get("display"));
    if (isNaN(n)) return;
    const toggled = MathEngine.toggleSign(n);
    State.set("display", String(toggled));
    Display.setRaw(String(toggled));
    // Update expression if it ends with the old value
    const expr = State.get("expression");
    if (expr.endsWith(String(n))) {
      State.set("expression", expr.slice(0, -String(n).length) + String(toggled));
      Display.setExpression(State.get("expression"));
    }
  };

  /* ─── Percentage ─── */
  const percent = () => {
    if (State.get("isError")) return;
    const n = parseFloat(State.get("display"));
    if (isNaN(n)) return;
    const result = MathEngine.applyPercent(n);
    State.set("display", String(result));
    Display.setRaw(String(result));
  };

  /* ─── Scientific Functions ─── */
  const applyScientific = (fn) => {
    if (State.get("isError")) return;

    // π is a constant, not a function of display value
    if (fn === "pi") {
      const pi = Math.PI;
      State.set("display", String(pi));
      State.set("expression", String(pi));
      State.set("justEvaluated", false);
      Display.setRaw(String(pi));
      Display.setExpression("π =");
      return;
    }

    // Power (xʸ) — set up to wait for the exponent
    if (fn === "power") {
      const base = State.get("display");
      State.set("expression", base + "**");
      State.set("waitingForOperand", true);
      State.set("justEvaluated", false);
      Display.setExpression(base + " ^ ");
      Toast.show("Enter exponent, then press =", "info");
      return;
    }

    // Modulus
    if (fn === "mod") {
      inputOperator("%");
      return;
    }

    const display = State.get("display");
    try {
      const result = MathEngine.applyScientific(fn, display);
      const clean  = MathEngine.format.clean(result);

      Display.setMain(clean, true);
      Display.setExpression(`${fn}(${display}) =`);
      Display.flashDisplay();

      State.set("display", String(clean));
      State.set("lastResult", clean);
      State.set("expression", String(clean));
      State.set("justEvaluated", true);

      History.add(`${fn}(${display})`, clean);

    } catch (err) {
      Display.setMain(err.message, false, true);
      State.set("isError", true);
      Toast.show(err.message, "error");
    }
  };

  /* ─── Recall a result from history ─── */
  const recallHistory = (result) => {
    State.set("display", String(result));
    State.set("expression", String(result));
    State.set("justEvaluated", true);
    State.set("isError", false);
    Display.setMain(result, false, false);
    Display.setExpression("History recall");
    Toast.show("Result restored", "success");
  };

  /* ─── Route all button actions ─── */
  const handleAction = (action) => {
    switch (action) {
      // Digits
      case "0": case "1": case "2": case "3": case "4":
      case "5": case "6": case "7": case "8": case "9":
        inputDigit(action); break;

      case ".": inputDecimal(); break;

      // Operators
      case "+": case "−": case "×": case "÷":
        inputOperator(action); break;

      // Parentheses
      case "(": case ")": inputParen(action); break;

      // Equals
      case "=": evaluate(); break;

      // Functions
      case "ac":           allClear();           break;
      case "backspace":    backspace();           break;
      case "toggle-sign":  toggleSign();          break;
      case "percent":      percent();             break;

      // Scientific
      case "sin": case "cos": case "tan":
      case "log": case "ln":  case "sqrt":
      case "square": case "power": case "mod": case "pi":
        applyScientific(action); break;

      // Memory
      case "mc":    Memory.clear();    break;
      case "mr":    Memory.recall();   break;
      case "mplus": Memory.add();      break;
      case "mminus":Memory.subtract(); break;
      case "ms":    Memory.store();    break;

      default: break;
    }
  };

  return { handleAction, recallHistory, allClear, evaluate };
})();

/* ═══════════════════════════════════════════════════════════
   MODULE 12 — KEYBOARD SUPPORT
   Full keyboard map with shortcuts.
═══════════════════════════════════════════════════════════ */
const Keyboard = (() => {

  /** Map keyboard keys to button data-action values */
  const KEY_MAP = {
    "0": "0", "1": "1", "2": "2", "3": "3", "4": "4",
    "5": "5", "6": "6", "7": "7", "8": "8", "9": "9",
    ".": ".",  ",": ".",
    "+": "+",
    "-": "−",
    "*": "×",
    "/": "÷",
    "%": "percent",
    "Enter":     "=",
    "=":         "=",
    "Backspace": "backspace",
    "Delete":    "ac",
    "Escape":    "ac",
    "(": "(",
    ")": ")",
  };

  /** Flash the corresponding button visually on keyboard press */
  const flashButton = (action) => {
    const btn = document.querySelector(`.btn[data-action="${action}"]`);
    if (!btn) return;
    btn.classList.add("key-active");
    setTimeout(() => btn.classList.remove("key-active"), 140);
  };

  const handleKeyDown = (e) => {
    // Alt shortcuts
    if (e.altKey) {
      if (e.key === "s" || e.key === "S") { e.preventDefault(); UI.toggleScientific(); return; }
      if (e.key === "h" || e.key === "H") { e.preventDefault(); UI.toggleHistory();    return; }
      if (e.key === "t" || e.key === "T") { e.preventDefault(); Theme.toggle();        return; }
    }

    // Ignore modifier combos except Ctrl+C (copy)
    if (e.ctrlKey && e.key === "c") {
      Clipboard.copy(State.get("display"));
      return;
    }
    if (e.ctrlKey || e.metaKey) return;

    const action = KEY_MAP[e.key];
    if (action) {
      e.preventDefault();
      Calculator.handleAction(action);
      flashButton(action);
    }
  };

  return {
    init: () => {
      document.addEventListener("keydown", handleKeyDown);
    },
  };
})();

/* ═══════════════════════════════════════════════════════════
   MODULE 13 — UI CONTROLS
   Scientific/history toggles, copy, header buttons.
═══════════════════════════════════════════════════════════ */
const UI = (() => ({

  toggleScientific: () => {
    const isSci = !State.get("isScientific");
    State.set("isScientific", isSci);

    DOM.sciRow.hidden = !isSci;
    DOM.sciToggleBtn.setAttribute("aria-pressed", isSci);
    DOM.sciToggleBtn.classList.toggle("active", isSci);
    DOM.modeIndicator.textContent = isSci ? "SCI" : "STD";

    Toast.show(isSci ? "Scientific mode on" : "Standard mode", "info");
  },

  toggleHistory: () => {
    const isOpen = !State.get("isHistoryOpen");
    State.set("isHistoryOpen", isOpen);

    DOM.historyPanel.hidden = !isOpen;
    DOM.historyToggleBtn.setAttribute("aria-pressed", isOpen);
    DOM.historyToggleBtn.classList.toggle("active", isOpen);
  },

}))();

/* ═══════════════════════════════════════════════════════════
   MODULE 14 — EVENT DELEGATION
   All click events wired via delegation from parent containers.
═══════════════════════════════════════════════════════════ */
const Events = (() => {

  /** Single delegated listener on a parent, dispatches to handler */
  const delegate = (parent, selector, handler) => {
    parent.addEventListener("click", (e) => {
      const target = e.target.closest(selector);
      if (target && parent.contains(target)) handler(target, e);
    });
  };

  return {
    init: () => {
      // ─── Keypad + Memory + Sci rows → Calculator actions ───
      // Delegate from the entire calculator article
      const calcEl = document.getElementById("calculator");

      delegate(calcEl, ".btn", (btn, e) => {
        const action = btn.dataset.action;
        if (!action) return;
        Ripple.create(btn, e);
        Calculator.handleAction(action);
      });

      // ─── Header controls ───
      DOM.themeToggleBtn.addEventListener("click",   () => Theme.toggle());
      DOM.sciToggleBtn.addEventListener("click",    () => UI.toggleScientific());
      DOM.historyToggleBtn.addEventListener("click", () => UI.toggleHistory());

      // ─── Copy button ───
      DOM.copyBtn.addEventListener("click", () => {
        Clipboard.copy(State.get("display"));
      });

      // ─── History clear ───
      DOM.historyClearBtn.addEventListener("click", () => History.clear());

      // ─── Prevent body scroll on button touch (mobile) ───
      calcEl.addEventListener("touchstart", (e) => {
        if (e.target.closest(".btn")) e.preventDefault();
      }, { passive: false });
    },
  };
})();

/* ═══════════════════════════════════════════════════════════
   MODULE 15 — INIT
   Boot sequence: loading screen → init all modules.
═══════════════════════════════════════════════════════════ */
const App = (() => ({

  init: () => {
    // 1. Apply saved theme immediately (no flash)
    Theme.init();

    // 2. Load history from storage
    History.init();

    // 3. Wire all events
    Events.init();

    // 4. Wire keyboard
    Keyboard.init();

    // 5. Dismiss loading screen after short delay
    setTimeout(() => {
      DOM.loadingScreen.classList.add("hidden");
    }, 900);
  },

}))();

/* ─── Bootstrap ─── */
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", App.init);
} else {
  App.init();
}