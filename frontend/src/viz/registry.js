// Universal Visualization Engine — module registry (plugin architecture).
//
// This is the single source of truth for the visualization catalogue. Each
// diagram "type" belongs to a category. A type is either IMPLEMENTED (it has a
// module in MODULES with an `engine`, so the renderer can draw it) or listed in
// the CATALOG as "on the roadmap" (shown in the UI, rendered by a later plugin).
//
// New modules register themselves by adding an entry to MODULES (or, in later
// phases, by calling registerModule at import time for lazy-loaded engines).
// Nothing here removes or depends on existing app code — it's fully additive.

// ---- Categories (the left-hand browser) ----------------------------------
export const CATEGORIES = [
  { id: "charts", label: "Basic Charts" },
  { id: "math", label: "Mathematical Graphs" },
  { id: "statistics", label: "Statistics" },
  { id: "economics", label: "Economics" },
  { id: "finance", label: "Accounting & Finance" },
  { id: "geography", label: "Geography" },
  { id: "biology", label: "Biology" },
  { id: "chemistry", label: "Chemistry" },
  { id: "physics", label: "Physics" },
  { id: "cs", label: "Computer Science" },
  { id: "business", label: "Business" },
  { id: "education", label: "Education" },
];

// ---- Full catalogue (every diagram the engine aims to support) -----------
// Names shown in the browser. Implemented ones (see MODULES) render now; the
// rest are on the roadmap and slot in as their plugin module ships.
export const CATALOG = {
  charts: [
    "Bar Chart", "Grouped Bar", "Stacked Bar", "Horizontal Bar", "Line Chart", "Spline Chart",
    "Step Chart", "Area Chart", "Stacked Area", "Pie Chart", "Donut Chart", "Scatter Plot",
    "Bubble Chart", "Histogram", "Radar Chart", "Polar Chart", "Box Plot", "Violin Plot",
    "Heatmap", "Treemap", "Sunburst", "Waterfall", "Candlestick", "OHLC", "Gauge", "Funnel",
    "Pyramid", "Pareto", "Lollipop", "Dot Plot", "Timeline", "Calendar Heatmap", "Gantt",
    "Sankey", "Chord Diagram", "Alluvial", "Network Graph", "Force Directed Graph",
  ],
  math: [
    "Cartesian Graph", "Quadratic", "Polynomial", "Exponential", "Logarithmic", "Trigonometric",
    "Hyperbola", "Parametric", "Polar Graph", "Implicit Function", "Derivative", "Integral",
    "Limit", "Taylor Series", "Complex Plane", "3D Surface", "Contour Plot", "Vector Field",
    "Slope Field", "Number Line", "Coordinate Plane",
  ],
  statistics: [
    "Normal Distribution", "Binomial", "Poisson", "Sampling Distribution", "Regression Line",
    "Multiple Regression", "Residual Plot", "QQ Plot", "Stem & Leaf", "Frequency Polygon",
    "Ogive", "Confidence Interval", "ANOVA", "Correlation Matrix", "Scatter Matrix",
  ],
  economics: [
    "Supply & Demand", "Demand Shift", "Supply Shift", "Elasticity", "PPF", "Indifference Curve",
    "Budget Line", "IS-LM", "AD-AS", "Phillips Curve", "Lorenz Curve", "Laffer Curve",
    "Production Function", "Isoquant", "Isocost", "Cost Curves", "Revenue Curves", "Monopoly",
    "Oligopoly", "Game Theory", "Circular Flow", "Business Cycle", "Solow Growth",
    "Comparative Advantage", "Trade Models", "Exchange Rate", "GDP Components", "Money Multiplier",
  ],
  finance: [
    "Balance Sheet", "Income Statement", "Cash Flow", "Ledger", "Journal Flow", "Trial Balance",
    "Break-even Chart", "Financial Ratios", "ROI", "NPV", "IRR", "Portfolio Allocation",
    "Stock Analysis", "Risk Return", "Candlestick", "MACD", "RSI", "Moving Average",
  ],
  geography: [
    "Population Pyramid", "Climate Graph", "Rainfall Graph", "River System", "Drainage Pattern",
    "Topographic Profile", "Contour Diagram", "Map", "Choropleth", "Flow Map", "Elevation",
    "DEM", "Terrain", "Wind Rose",
  ],
  biology: [
    "Cell Structure", "DNA", "RNA", "Mitosis", "Meiosis", "Food Chain", "Food Web", "Human Body",
    "Plant Cell", "Animal Cell", "Ecosystem", "Classification Tree",
  ],
  chemistry: [
    "Bohr Model", "Atomic Structure", "Molecular Structure", "Reaction Diagram",
    "Reaction Mechanism", "Substitution Mechanism", "Addition Mechanism",
    "Elimination Mechanism", "Rearrangement Mechanism", "Combined Mechanisms",
    "Periodic Table", "Electron Configuration", "Energy Level", "Orbital Diagram",
  ],
  physics: [
    "Free Body Diagram", "Projectile Motion", "Wave", "Circuit Diagram", "Optics", "Ray Diagram",
    "Electric Field", "Magnetic Field", "Energy Diagram",
  ],
  cs: [
    "Flowchart", "Algorithm Flow", "ER Diagram", "DFD", "UML", "Sequence Diagram",
    "Activity Diagram", "Class Diagram", "State Diagram", "Mind Map", "Architecture Diagram",
    "Network Diagram", "API Flow", "Database Schema", "Tree", "Binary Tree", "AVL", "Graph",
    "Linked List", "Queue", "Stack", "Heap", "Trie", "FSM",
  ],
  business: [
    "SWOT", "PESTLE", "BCG Matrix", "Porter's Five Forces", "Value Chain",
    "Business Model Canvas", "Organization Chart", "Decision Tree", "Fishbone", "Kanban",
    "Roadmap", "Customer Journey",
  ],
  education: [
    "Concept Map", "Mind Map", "Flashcards", "Learning Tree", "Process Diagram", "Cause Effect",
    "Comparison Chart", "Cycle Diagram", "Timeline",
  ],
};

// Turn a human name ("Grouped Bar") into a stable type id ("groupedbar").
export const slug = (name) => String(name || "").toLowerCase().replace(/&/g, "").replace(/[^a-z0-9]+/g, "");

// ---- Implemented modules (Phase 1 — Chart.js engine, no new dependencies) --
// Each entry: { id, label, category, engine, chartType, sample }. `sample` is a
// ready-to-render spec used when the type is picked from the browser.
const bar = (labels, data) => ({ labels, series: [{ name: "Series 1", data }] });

export const MODULES = {
  bar:            { label: "Bar Chart",       category: "charts", engine: "chartjs", chartType: "bar",     sample: { type: "bar", title: "Bar Chart", ...bar(["A", "B", "C", "D"], [12, 19, 8, 15]) } },
  groupedbar:     { label: "Grouped Bar",     category: "charts", engine: "chartjs", chartType: "bar",     sample: { type: "groupedbar", title: "Grouped Bar", labels: ["Q1", "Q2", "Q3"], series: [{ name: "2023", data: [10, 14, 9] }, { name: "2024", data: [13, 11, 16] }] } },
  stackedbar:     { label: "Stacked Bar",     category: "charts", engine: "chartjs", chartType: "bar",     sample: { type: "stackedbar", title: "Stacked Bar", options: { stacked: true }, labels: ["Q1", "Q2", "Q3"], series: [{ name: "Product A", data: [10, 14, 9] }, { name: "Product B", data: [7, 5, 12] }] } },
  horizontalbar:  { label: "Horizontal Bar",  category: "charts", engine: "chartjs", chartType: "bar",     sample: { type: "horizontalbar", title: "Horizontal Bar", options: { horizontal: true }, ...bar(["North", "South", "East", "West"], [22, 17, 9, 14]) } },
  line:           { label: "Line Chart",      category: "charts", engine: "chartjs", chartType: "line",    sample: { type: "line", title: "Line Chart", labels: ["Jan", "Feb", "Mar", "Apr", "May"], series: [{ name: "Users", data: [30, 45, 40, 60, 75] }] } },
  spline:         { label: "Spline Chart",    category: "charts", engine: "chartjs", chartType: "line",    sample: { type: "spline", title: "Spline Chart", options: { smooth: true }, labels: ["Jan", "Feb", "Mar", "Apr", "May"], series: [{ name: "Revenue", data: [30, 45, 40, 60, 75] }] } },
  step:           { label: "Step Chart",      category: "charts", engine: "chartjs", chartType: "line",    sample: { type: "step", title: "Step Chart", options: { stepped: true }, labels: ["Mon", "Tue", "Wed", "Thu"], series: [{ name: "Price", data: [10, 10, 14, 12] }] } },
  area:           { label: "Area Chart",      category: "charts", engine: "chartjs", chartType: "line",    sample: { type: "area", title: "Area Chart", options: { area: true }, labels: ["Jan", "Feb", "Mar", "Apr", "May"], series: [{ name: "Sessions", data: [30, 45, 40, 60, 75] }] } },
  stackedarea:    { label: "Stacked Area",    category: "charts", engine: "chartjs", chartType: "line",    sample: { type: "stackedarea", title: "Stacked Area", options: { area: true, stacked: true }, labels: ["Jan", "Feb", "Mar", "Apr"], series: [{ name: "Desktop", data: [20, 25, 22, 30] }, { name: "Mobile", data: [10, 18, 24, 28] }] } },
  pie:            { label: "Pie Chart",       category: "charts", engine: "chartjs", chartType: "pie",     sample: { type: "pie", title: "Pie Chart", labels: ["Agriculture", "Industry", "Services"], series: [{ name: "GDP", data: [18, 27, 55] }] } },
  donut:          { label: "Donut Chart",     category: "charts", engine: "chartjs", chartType: "doughnut", sample: { type: "donut", title: "Donut Chart", options: { donut: true }, labels: ["Agriculture", "Industry", "Services"], series: [{ name: "GDP", data: [18, 27, 55] }] } },
  scatter:        { label: "Scatter Plot",    category: "charts", engine: "chartjs", chartType: "scatter", sample: { type: "scatter", title: "Scatter Plot", series: [{ name: "Points", data: [{ x: 1, y: 3 }, { x: 2, y: 5 }, { x: 3, y: 4 }, { x: 4, y: 8 }, { x: 5, y: 7 }] }] } },
  bubble:         { label: "Bubble Chart",    category: "charts", engine: "chartjs", chartType: "bubble",  sample: { type: "bubble", title: "Bubble Chart", series: [{ name: "Markets", data: [{ x: 10, y: 20, r: 8 }, { x: 20, y: 30, r: 14 }, { x: 30, y: 15, r: 6 }] }] } },
  radar:          { label: "Radar Chart",     category: "charts", engine: "chartjs", chartType: "radar",   sample: { type: "radar", title: "Radar Chart", labels: ["Speed", "Power", "Range", "Agility", "Defense"], series: [{ name: "Player", data: [65, 59, 80, 81, 56] }] } },
  polar:          { label: "Polar Chart",     category: "charts", engine: "chartjs", chartType: "polarArea", sample: { type: "polar", title: "Polar Area", labels: ["Red", "Green", "Blue", "Yellow"], series: [{ name: "Votes", data: [11, 16, 7, 14] }] } },
  histogram:      { label: "Histogram",       category: "charts", engine: "chartjs", chartType: "bar",     sample: { type: "histogram", title: "Histogram", options: { beginAtZero: true }, labels: ["0-10", "10-20", "20-30", "30-40", "40-50"], series: [{ name: "Frequency", data: [4, 9, 15, 8, 3] }] } },

  // Economics supply/demand rendered as a two-line chart (Phase 1 chart engine).
  supplydemand:   { label: "Supply & Demand", category: "economics", engine: "chartjs", chartType: "line", sample: { type: "supplydemand", title: "Supply & Demand", labels: ["0", "20", "40", "60", "80", "100"], series: [{ name: "Demand", data: [100, 80, 60, 40, 20, 0] }, { name: "Supply", data: [0, 20, 40, 60, 80, 100] }] } },
  gdpcomponents:  { label: "GDP Components",  category: "economics", engine: "chartjs", chartType: "pie",  sample: { type: "gdpcomponents", title: "GDP Components", labels: ["Consumption", "Investment", "Govt", "Net Exports"], series: [{ name: "GDP", data: [60, 18, 20, 2] }] } },
  populationpyramid: { label: "Population Pyramid", category: "geography", engine: "chartjs", chartType: "bar", sample: { type: "populationpyramid", title: "Population Pyramid", options: { horizontal: true, stacked: true }, labels: ["0-14", "15-24", "25-54", "55-64", "65+"], series: [{ name: "Male", data: [-30, -25, -40, -12, -8] }, { name: "Female", data: [28, 24, 41, 13, 10] }] } },
  climategraph:   { label: "Climate Graph",   category: "geography", engine: "chartjs", chartType: "bar",  sample: { type: "climategraph", title: "Climate Graph", labels: ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"], series: [{ name: "Rainfall (mm)", data: [40, 35, 50, 60, 90, 120, 160, 150, 100, 70, 50, 45] }] } },

  // ---- Mermaid engine (text-defined diagrams) — lazy-loaded, no bundle cost ----
  flowchart:       { label: "Flowchart",         category: "cs",        engine: "mermaid", sample: { type: "flowchart", title: "Flowchart", code: "flowchart TD\n  A[Start] --> B{Decision?}\n  B -->|Yes| C[Do this]\n  B -->|No| D[Do that]\n  C --> E[End]\n  D --> E" } },
  algorithmflow:   { label: "Algorithm Flow",    category: "cs",        engine: "mermaid", sample: { type: "algorithmflow", title: "Algorithm Flow", code: "flowchart TD\n  A([Start]) --> B[/Read input/]\n  B --> C{n > 0?}\n  C -->|Yes| D[Process]\n  D --> C\n  C -->|No| E([End])" } },
  activitydiagram: { label: "Activity Diagram",  category: "cs",        engine: "mermaid", sample: { type: "activitydiagram", title: "Activity Diagram", code: "flowchart TD\n  Start --> Login\n  Login --> Valid{Valid?}\n  Valid -->|Yes| Dashboard\n  Valid -->|No| Login\n  Dashboard --> Logout --> Stop([End])" } },
  processdiagram:  { label: "Process Diagram",   category: "education", engine: "mermaid", sample: { type: "processdiagram", title: "Process Diagram", code: "flowchart LR\n  A[Plan] --> B[Do] --> C[Check] --> D[Act] --> A" } },
  mindmap:         { label: "Mind Map",          category: "education", engine: "mermaid", sample: { type: "mindmap", title: "Mind Map", code: "mindmap\n  root((Main Topic))\n    Subtopic 1\n      Idea A\n      Idea B\n    Subtopic 2\n      Idea C\n    Subtopic 3" } },
  conceptmap:      { label: "Concept Map",       category: "education", engine: "mermaid", sample: { type: "conceptmap", title: "Concept Map", code: "mindmap\n  root((Concept))\n    Definition\n    Examples\n    Related ideas\n    Applications" } },
  learningtree:    { label: "Learning Tree",     category: "education", engine: "mermaid", sample: { type: "learningtree", title: "Learning Tree", code: "flowchart TD\n  Topic --> A[Prerequisite 1]\n  Topic --> B[Prerequisite 2]\n  A --> C[Advanced Skill]\n  B --> C" } },
  sequencediagram: { label: "Sequence Diagram",  category: "cs",        engine: "mermaid", sample: { type: "sequencediagram", title: "Sequence Diagram", code: "sequenceDiagram\n  participant U as User\n  participant S as Server\n  U->>S: Request\n  S-->>U: Response" } },
  classdiagram:    { label: "Class Diagram",     category: "cs",        engine: "mermaid", sample: { type: "classdiagram", title: "Class Diagram", code: "classDiagram\n  class Animal {\n    +String name\n    +int age\n    +makeSound()\n  }\n  Animal <|-- Dog\n  Animal <|-- Cat" } },
  uml:             { label: "UML",               category: "cs",        engine: "mermaid", sample: { type: "uml", title: "UML Class Diagram", code: "classDiagram\n  class Account {\n    +String id\n    +deposit()\n    +withdraw()\n  }\n  Account <|-- Savings\n  Account <|-- Current" } },
  statediagram:    { label: "State Diagram",     category: "cs",        engine: "mermaid", sample: { type: "statediagram", title: "State Diagram", code: "stateDiagram-v2\n  [*] --> Idle\n  Idle --> Running : start\n  Running --> Idle : stop\n  Running --> [*]" } },
  erdiagram:       { label: "ER Diagram",        category: "cs",        engine: "mermaid", sample: { type: "erdiagram", title: "ER Diagram", code: "erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  ORDER ||--|{ LINE_ITEM : contains\n  CUSTOMER {\n    string name\n    string email\n  }" } },
  gantt:           { label: "Gantt",             category: "charts",    engine: "mermaid", sample: { type: "gantt", title: "Gantt Chart", code: "gantt\n  title Project Plan\n  dateFormat YYYY-MM-DD\n  section Phase 1\n  Research :a1, 2024-01-01, 20d\n  Design   :after a1, 15d\n  section Phase 2\n  Build    :2024-02-15, 30d" } },
  timeline:        { label: "Timeline",          category: "charts",    engine: "mermaid", sample: { type: "timeline", title: "Timeline", code: "timeline\n  title History\n  2001 : Founded\n  2010 : Expanded\n  2020 : Went global" } },
  customerjourney: { label: "Customer Journey",  category: "business",  engine: "mermaid", sample: { type: "customerjourney", title: "Customer Journey", code: "journey\n  title Customer Journey\n  section Discover\n    Visit site: 3: Customer\n    Read reviews: 4: Customer\n  section Buy\n    Add to cart: 5: Customer\n    Checkout: 3: Customer" } },
};

// ---- Phase 3: math / statistics / economics / finance (Chart.js engine) ----
// A function, distribution, or economics curve is just a line/scatter/bar chart
// with computed points — so these render on the SAME verified Chart.js engine,
// no new dependency. The samples give a real starting graph; the AI computes
// fresh data for any prompt. Multiple curves = multiple series.
const _range = (a, b, step = 1) => { const r = []; for (let x = a; x <= b + 1e-9; x += step) r.push(Math.round(x * 100) / 100); return r; };
const _line = (type, label, category, labels, series, options = {}) => ({ label, category, engine: "chartjs", chartType: "line", sample: { type, title: label, labels, series, options: { smooth: true, ...options } } });
const _scatter = (type, label, category, series, options = {}) => ({ label, category, engine: "chartjs", chartType: "scatter", sample: { type, title: label, series, options } });
const _bar = (type, label, category, labels, series, options = {}) => ({ label, category, engine: "chartjs", chartType: "bar", sample: { type, title: label, labels, series, options } });
const _pie = (type, label, category, labels, data) => ({ label, category, engine: "chartjs", chartType: "pie", sample: { type, title: label, labels, series: [{ name: label, data }] } });
const _X = _range(-5, 5);
const _Q = _range(0, 100, 20);
const _sin = (deg) => Math.round(Math.sin((deg * Math.PI) / 180) * 100) / 100;
const _cos = (deg) => Math.round(Math.cos((deg * Math.PI) / 180) * 100) / 100;

Object.assign(MODULES, {
  // Mathematics
  quadratic:      _line("quadratic", "Quadratic (y=x²)", "math", _X, [{ name: "y = x²", data: _X.map((x) => x * x) }], { beginAtZero: false }),
  polynomial:     _line("polynomial", "Polynomial", "math", _X, [{ name: "y = x³−3x", data: _X.map((x) => x ** 3 - 3 * x) }], { beginAtZero: false }),
  exponential:    _line("exponential", "Exponential (y=2ˣ)", "math", _range(-3, 5, 0.5), [{ name: "y = 2^x", data: _range(-3, 5, 0.5).map((x) => Math.round(Math.pow(2, x) * 100) / 100) }]),
  logarithmic:    _line("logarithmic", "Logarithmic (y=ln x)", "math", _range(0.2, 8, 0.4), [{ name: "y = ln x", data: _range(0.2, 8, 0.4).map((x) => Math.round(Math.log(x) * 100) / 100) }], { beginAtZero: false }),
  trigonometric:  _line("trigonometric", "Sine & Cosine", "math", _range(0, 360, 30), [{ name: "sin", data: _range(0, 360, 30).map(_sin) }, { name: "cos", data: _range(0, 360, 30).map(_cos) }], { beginAtZero: false }),
  derivative:     _line("derivative", "Function & Derivative", "math", _X, [{ name: "f(x)=x²", data: _X.map((x) => x * x) }, { name: "f'(x)=2x", data: _X.map((x) => 2 * x) }], { beginAtZero: false }),
  integral:       _line("integral", "Function & Integral", "math", _X, [{ name: "f(x)=x", data: _X.map((x) => x) }, { name: "∫f = x²/2", data: _X.map((x) => Math.round((x * x) / 2 * 100) / 100) }], { beginAtZero: false }),
  parametric:     _scatter("parametric", "Parametric (circle)", "math", [{ name: "x=cos t, y=sin t", data: _range(0, 360, 15).map((d) => ({ x: _cos(d), y: _sin(d) })), line: true }]),

  // Statistics
  normaldistribution: _line("normaldistribution", "Normal Distribution", "statistics", _range(-4, 4, 0.5), [{ name: "f(x)", data: _range(-4, 4, 0.5).map((x) => Math.round((Math.exp((-x * x) / 2) / Math.sqrt(2 * Math.PI)) * 1000) / 1000) }], { beginAtZero: true }),
  binomial:       _bar("binomial", "Binomial Distribution", "statistics", ["0", "1", "2", "3", "4", "5", "6"], [{ name: "P(X)", data: [1, 6, 15, 20, 15, 6, 1].map((v) => Math.round((v / 64) * 1000) / 1000) }]),
  poisson:        _bar("poisson", "Poisson Distribution", "statistics", ["0", "1", "2", "3", "4", "5", "6"], [{ name: "P(X)", data: [0.05, 0.15, 0.22, 0.22, 0.17, 0.1, 0.05] }]),
  regressionline: _scatter("regressionline", "Regression Line", "statistics", [{ name: "Data", data: [{ x: 1, y: 2 }, { x: 2, y: 2.8 }, { x: 3, y: 3.6 }, { x: 4, y: 5 }, { x: 5, y: 5.5 }] }, { name: "Trend", data: [{ x: 1, y: 2 }, { x: 5, y: 5.6 }], line: true }]),
  residualplot:   _scatter("residualplot", "Residual Plot", "statistics", [{ name: "Residuals", data: [{ x: 1, y: 0.2 }, { x: 2, y: -0.3 }, { x: 3, y: 0.1 }, { x: 4, y: 0.4 }, { x: 5, y: -0.2 }] }]),
  frequencypolygon: _line("frequencypolygon", "Frequency Polygon", "statistics", ["10", "20", "30", "40", "50"], [{ name: "Frequency", data: [4, 9, 15, 8, 3] }], { smooth: false }),
  ogive:          _line("ogive", "Ogive (Cumulative)", "statistics", ["10", "20", "30", "40", "50"], [{ name: "Cumulative f", data: [4, 13, 28, 36, 39] }], { smooth: false }),
  confidenceinterval: _bar("confidenceinterval", "Confidence Interval", "statistics", ["A", "B", "C", "D"], [{ name: "Mean", data: [50, 62, 45, 58] }]),

  // Economics
  demandshift:    _line("demandshift", "Demand Shift", "economics", _Q, [{ name: "D₁", data: [100, 80, 60, 40, 30, 20] }, { name: "D₂ (shift)", data: [120, 100, 80, 60, 50, 40] }, { name: "Supply", data: [0, 20, 40, 60, 80, 100] }], { beginAtZero: true, smooth: false }),
  supplyshift:    _line("supplyshift", "Supply Shift", "economics", _Q, [{ name: "Demand", data: [100, 80, 60, 40, 20, 0] }, { name: "S₁", data: [0, 20, 40, 60, 80, 100] }, { name: "S₂ (shift)", data: [20, 40, 60, 80, 100, 120] }], { beginAtZero: true, smooth: false }),
  elasticity:     _line("elasticity", "Elasticity of Demand", "economics", _Q, [{ name: "Elastic", data: [100, 70, 45, 25, 10, 0] }, { name: "Inelastic", data: [100, 92, 82, 70, 55, 35] }], { beginAtZero: true, smooth: false }),
  ppf:            _line("ppf", "Production Possibility Frontier", "economics", _range(0, 100, 20), [{ name: "PPF", data: [100, 96, 88, 74, 50, 0] }], { beginAtZero: true }),
  indifferencecurve: _line("indifferencecurve", "Indifference Curve", "economics", _range(1, 10, 1), [{ name: "IC", data: _range(1, 10, 1).map((x) => Math.round(40 / x)) }], { beginAtZero: true }),
  budgetline:     _line("budgetline", "Budget Line", "economics", _range(0, 10, 2), [{ name: "Budget", data: [10, 8, 6, 4, 2, 0] }], { beginAtZero: true, smooth: false }),
  islm:           _line("islm", "IS-LM", "economics", _range(0, 100, 20), [{ name: "IS", data: [80, 64, 48, 32, 16, 0] }, { name: "LM", data: [0, 16, 32, 48, 64, 80] }], { beginAtZero: true, smooth: false }),
  adas:           _line("adas", "AD-AS", "economics", _range(0, 100, 20), [{ name: "AD", data: [100, 80, 60, 40, 20, 0] }, { name: "AS", data: [0, 20, 40, 60, 80, 100] }], { beginAtZero: true, smooth: false }),
  phillipscurve:  _line("phillipscurve", "Phillips Curve", "economics", _range(1, 10, 1), [{ name: "Inflation", data: _range(1, 10, 1).map((u) => Math.round((100 / u)) / 10) }], { beginAtZero: true }),
  laffercurve:    _line("laffercurve", "Laffer Curve", "economics", _range(0, 100, 10), [{ name: "Revenue", data: _range(0, 100, 10).map((t) => Math.round((t * (100 - t)) / 25)) }], { beginAtZero: true }),
  lorenzcurve:    _line("lorenzcurve", "Lorenz Curve", "economics", _range(0, 100, 20), [{ name: "Equality", data: [0, 20, 40, 60, 80, 100] }, { name: "Lorenz", data: [0, 5, 15, 35, 60, 100] }], { beginAtZero: true, smooth: false }),
  costcurves:     _line("costcurves", "Cost Curves", "economics", _range(1, 10, 1), [{ name: "ATC", data: [50, 30, 23, 20, 19, 20, 22, 25, 29, 34] }, { name: "MC", data: [5, 6, 7, 9, 11, 13, 16, 20, 24, 28] }], { beginAtZero: true }),
  revenuecurves:  _line("revenuecurves", "Revenue Curves", "economics", _range(1, 10, 1), [{ name: "AR", data: _range(1, 10, 1).map((q) => Math.max(0, 20 - 2 * q)) }, { name: "MR", data: _range(1, 10, 1).map((q) => 20 - 4 * q) }], { beginAtZero: false }),
  gdpcomponentsbar: _bar("gdpcomponentsbar", "GDP Components (bar)", "economics", ["C", "I", "G", "NX"], [{ name: "% of GDP", data: [60, 18, 20, 2] }]),

  // Accounting & Finance
  breakevenchart: _line("breakevenchart", "Break-even Chart", "finance", _range(0, 100, 20), [{ name: "Revenue", data: [0, 40, 80, 120, 160, 200] }, { name: "Total Cost", data: [50, 70, 90, 110, 130, 150] }], { beginAtZero: true, smooth: false }),
  roi:            _bar("roi", "ROI by Project", "finance", ["A", "B", "C", "D"], [{ name: "ROI %", data: [12, 18, 9, 22] }]),
  riskreturn:     _scatter("riskreturn", "Risk vs Return", "finance", [{ name: "Assets", data: [{ x: 5, y: 4 }, { x: 10, y: 7 }, { x: 15, y: 11 }, { x: 20, y: 13 }] }]),
  movingaverage:  _line("movingaverage", "Moving Average", "finance", ["1", "2", "3", "4", "5", "6", "7", "8"], [{ name: "Price", data: [10, 12, 11, 14, 13, 16, 15, 18] }, { name: "MA(3)", data: [null, null, 11, 12.3, 12.7, 14.3, 14.7, 16.3] }], { smooth: false }),
  portfolioallocation: _pie("portfolioallocation", "Portfolio Allocation", "finance", ["Stocks", "Bonds", "Cash", "Real Estate"], [50, 25, 10, 15]),
  financialratios: _bar("financialratios", "Financial Ratios", "finance", ["Current", "Quick", "Debt/Equity", "ROE"], [{ name: "Ratio", data: [1.8, 1.2, 0.6, 0.15] }]),

  // Extra chart shapes on the Chart.js engine
  pyramid:        _bar("pyramid", "Pyramid", "charts", ["Level 4", "Level 3", "Level 2", "Level 1"], [{ name: "Value", data: [10, 25, 45, 70] }], { horizontal: true }),
  lollipop:       _bar("lollipop", "Lollipop (bar)", "charts", ["A", "B", "C", "D", "E"], [{ name: "Value", data: [8, 15, 12, 20, 6] }]),
  dotplot:        _scatter("dotplot", "Dot Plot", "charts", [{ name: "Values", data: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 1 }, { x: 3, y: 2 }, { x: 3, y: 3 }, { x: 4, y: 1 }] }]),
});

// ---- Phase 4: Plotly engine (advanced scientific / statistical charts) ------
// These carry a ready Plotly figure in `sample.plotly = { data, layout }`.
// Plotly is CDN-lazy-loaded (see PlotlyRenderer) — no dependency, no bundle cost.
const _plotly = (type, label, category, data, layout = {}) => ({ label, category, engine: "plotly", sample: { type, title: label, plotly: { data, layout } } });

Object.assign(MODULES, {
  heatmap:        _plotly("heatmap", "Heatmap", "charts", [{ z: [[1, 20, 30], [20, 1, 60], [30, 60, 1]], x: ["A", "B", "C"], y: ["X", "Y", "Z"], type: "heatmap", colorscale: "Blues" }]),
  boxplot:        _plotly("boxplot", "Box Plot", "charts", [{ y: [1, 2, 2, 3, 4, 4, 4, 5, 7, 9], type: "box", name: "Sample" }]),
  violinplot:     _plotly("violinplot", "Violin Plot", "charts", [{ y: [1, 2, 2, 3, 4, 4, 4, 5, 7, 9], type: "violin", box: { visible: true }, meanline: { visible: true }, name: "Sample" }]),
  sankey:         _plotly("sankey", "Sankey Diagram", "charts", [{ type: "sankey", orientation: "h", node: { label: ["Coal", "Gas", "Electricity", "Homes", "Industry"], pad: 15, thickness: 16 }, link: { source: [0, 1, 2, 2], target: [2, 2, 3, 4], value: [8, 4, 7, 5] } }]),
  treemap:        _plotly("treemap", "Treemap", "charts", [{ type: "treemap", labels: ["Total", "A", "B", "A1", "A2", "B1"], parents: ["", "Total", "Total", "A", "A", "B"], values: [0, 6, 4, 3, 3, 4] }]),
  sunburst:       _plotly("sunburst", "Sunburst", "charts", [{ type: "sunburst", labels: ["Total", "A", "B", "A1", "A2", "B1"], parents: ["", "Total", "Total", "A", "A", "B"], values: [0, 6, 4, 3, 3, 4], branchvalues: "total" }]),
  candlestick:    _plotly("candlestick", "Candlestick", "charts", [{ type: "candlestick", x: ["Mon", "Tue", "Wed", "Thu", "Fri"], open: [10, 12, 11, 13, 12], high: [12, 14, 13, 15, 14], low: [9, 11, 10, 12, 11], close: [11, 13, 12, 14, 13] }]),
  ohlc:           _plotly("ohlc", "OHLC", "charts", [{ type: "ohlc", x: ["Mon", "Tue", "Wed", "Thu", "Fri"], open: [10, 12, 11, 13, 12], high: [12, 14, 13, 15, 14], low: [9, 11, 10, 12, 11], close: [11, 13, 12, 14, 13] }]),
  gauge:          _plotly("gauge", "Gauge", "charts", [{ type: "indicator", mode: "gauge+number", value: 68, gauge: { axis: { range: [0, 100] }, bar: { color: "#2563eb" } } }]),
  funnel:         _plotly("funnel", "Funnel", "charts", [{ type: "funnel", y: ["Visits", "Sign-ups", "Trials", "Paid"], x: [1000, 600, 300, 120] }]),
  waterfall:      _plotly("waterfall", "Waterfall", "charts", [{ type: "waterfall", x: ["Start", "Q1", "Q2", "Q3", "Total"], measure: ["absolute", "relative", "relative", "relative", "total"], y: [100, 20, -30, 40, 0] }]),
  "3dsurface":    _plotly("3dsurface", "3D Surface", "math", [{ type: "surface", z: [[1, 2, 3, 2], [2, 4, 5, 3], [3, 5, 7, 4], [2, 3, 4, 2]] }]),
  contourplot:    _plotly("contourplot", "Contour Plot", "math", [{ type: "contour", z: [[1, 2, 3, 2], [2, 4, 5, 3], [3, 5, 7, 4], [2, 3, 4, 2]], colorscale: "Viridis" }]),
  correlationmatrix: _plotly("correlationmatrix", "Correlation Matrix", "statistics", [{ z: [[1, 0.8, -0.3], [0.8, 1, -0.1], [-0.3, -0.1, 1]], x: ["A", "B", "C"], y: ["A", "B", "C"], type: "heatmap", colorscale: "RdBu", zmin: -1, zmax: 1 }]),
  scattermatrix:  _plotly("scattermatrix", "Scatter Matrix", "statistics", [{ type: "splom", dimensions: [{ label: "A", values: [1, 2, 3, 4, 5] }, { label: "B", values: [5, 3, 4, 2, 1] }, { label: "C", values: [2, 4, 1, 5, 3] }] }]),
});

// ---- Phase 5: graph / network / tree / data structures (Cytoscape engine) ---
// Carry `sample.graph = { nodes, edges, layout, directed }`. Cytoscape is
// CDN-lazy-loaded (see GraphRenderer). Layouts: breadthfirst (trees/hierarchy),
// cose (force-directed networks), grid, circle, concentric.
const _graph = (type, label, category, nodes, edges, layout = "breadthfirst", directed = true) => ({ label, category, engine: "cytoscape", sample: { type, title: label, graph: { nodes, edges, layout, directed } } });
const _chain = (ids) => ids.map((id, i) => (i ? { source: ids[i - 1], target: id } : null)).filter(Boolean);

Object.assign(MODULES, {
  networkgraph:      _graph("networkgraph", "Network Graph", "cs", [{ id: "A" }, { id: "B" }, { id: "C" }, { id: "D" }, { id: "E" }], [{ source: "A", target: "B" }, { source: "A", target: "C" }, { source: "B", target: "D" }, { source: "C", target: "D" }, { source: "D", target: "E" }, { source: "E", target: "A" }], "cose", false),
  forcedirectedgraph:_graph("forcedirectedgraph", "Force-Directed Graph", "charts", [{ id: "1" }, { id: "2" }, { id: "3" }, { id: "4" }, { id: "5" }, { id: "6" }], [{ source: "1", target: "2" }, { source: "1", target: "3" }, { source: "2", target: "4" }, { source: "3", target: "5" }, { source: "4", target: "6" }, { source: "5", target: "6" }, { source: "2", target: "5" }], "cose", false),
  graph:             _graph("graph", "Graph", "cs", [{ id: "A" }, { id: "B" }, { id: "C" }, { id: "D" }], [{ source: "A", target: "B" }, { source: "B", target: "C" }, { source: "C", target: "D" }, { source: "D", target: "A" }, { source: "A", target: "C" }], "circle", false),
  tree:              _graph("tree", "Tree", "cs", [{ id: "Root" }, { id: "A" }, { id: "B" }, { id: "C" }, { id: "A1" }, { id: "A2" }, { id: "B1" }], [{ source: "Root", target: "A" }, { source: "Root", target: "B" }, { source: "Root", target: "C" }, { source: "A", target: "A1" }, { source: "A", target: "A2" }, { source: "B", target: "B1" }]),
  binarytree:        _graph("binarytree", "Binary Tree", "cs", [{ id: "8" }, { id: "3" }, { id: "10" }, { id: "1" }, { id: "6" }, { id: "14" }], [{ source: "8", target: "3" }, { source: "8", target: "10" }, { source: "3", target: "1" }, { source: "3", target: "6" }, { source: "10", target: "14" }]),
  avl:               _graph("avl", "AVL Tree", "cs", [{ id: "30" }, { id: "20" }, { id: "40" }, { id: "10" }, { id: "25" }, { id: "50" }], [{ source: "30", target: "20" }, { source: "30", target: "40" }, { source: "20", target: "10" }, { source: "20", target: "25" }, { source: "40", target: "50" }]),
  heap:              _graph("heap", "Heap", "cs", [{ id: "1" }, { id: "3" }, { id: "6" }, { id: "5" }, { id: "9" }, { id: "8" }], [{ source: "1", target: "3" }, { source: "1", target: "6" }, { source: "3", target: "5" }, { source: "3", target: "9" }, { source: "6", target: "8" }]),
  trie:              _graph("trie", "Trie", "cs", [{ id: "root", label: "•" }, { id: "c", label: "c" }, { id: "a", label: "a" }, { id: "t", label: "t" }, { id: "r", label: "r" }], [{ source: "root", target: "c" }, { source: "c", target: "a" }, { source: "a", target: "t" }, { source: "a", target: "r" }]),
  linkedlist:        _graph("linkedlist", "Linked List", "cs", [{ id: "10" }, { id: "20" }, { id: "30" }, { id: "40" }], _chain(["10", "20", "30", "40"]), "grid"),
  queue:             _graph("queue", "Queue (FIFO)", "cs", [{ id: "front" }, { id: "a" }, { id: "b" }, { id: "c" }, { id: "rear" }], _chain(["front", "a", "b", "c", "rear"]), "grid"),
  stack:             _graph("stack", "Stack (LIFO)", "cs", [{ id: "top" }, { id: "x" }, { id: "y" }, { id: "z", label: "bottom" }], _chain(["top", "x", "y", "z"]), "breadthfirst"),
  organizationchart: _graph("organizationchart", "Organization Chart", "business", [{ id: "CEO" }, { id: "CTO" }, { id: "CFO" }, { id: "COO" }, { id: "Eng" }, { id: "Data" }], [{ source: "CEO", target: "CTO" }, { source: "CEO", target: "CFO" }, { source: "CEO", target: "COO" }, { source: "CTO", target: "Eng" }, { source: "CTO", target: "Data" }]),
  decisiontree:      _graph("decisiontree", "Decision Tree", "business", [{ id: "q1", label: "Budget > 1000?" }, { id: "q2", label: "Urgent?" }, { id: "buy", label: "Buy" }, { id: "wait", label: "Wait" }, { id: "rent", label: "Rent" }], [{ source: "q1", target: "q2", label: "Yes" }, { source: "q1", target: "rent", label: "No" }, { source: "q2", target: "buy", label: "Yes" }, { source: "q2", target: "wait", label: "No" }]),
  classificationtree:_graph("classificationtree", "Classification Tree", "biology", [{ id: "Animalia" }, { id: "Chordata" }, { id: "Mammalia" }, { id: "Carnivora" }, { id: "Felidae" }, { id: "Panthera" }], _chain(["Animalia", "Chordata", "Mammalia", "Carnivora", "Felidae", "Panthera"])),
  foodchain:         _graph("foodchain", "Food Chain", "biology", [{ id: "Grass" }, { id: "Grasshopper" }, { id: "Frog" }, { id: "Snake" }, { id: "Eagle" }], _chain(["Grass", "Grasshopper", "Frog", "Snake", "Eagle"]), "grid"),
  foodweb:           _graph("foodweb", "Food Web", "biology", [{ id: "Plants" }, { id: "Insect" }, { id: "Rabbit" }, { id: "Bird" }, { id: "Fox" }, { id: "Hawk" }], [{ source: "Plants", target: "Insect" }, { source: "Plants", target: "Rabbit" }, { source: "Insect", target: "Bird" }, { source: "Rabbit", target: "Fox" }, { source: "Bird", target: "Hawk" }, { source: "Fox", target: "Hawk" }, { source: "Bird", target: "Fox" }], "cose"),
});

// ---- Phase 6: business / strategy frameworks (pure SVG, no library) --------
// Carry `sample.framework = { kind, cols?, cells:[{ title, items[] }] }`.
const _fw = (type, label, category, kind, cells, extra = {}) => ({ label, category, engine: "framework", sample: { type, title: label, framework: { kind, cells, ...extra } } });

Object.assign(MODULES, {
  swot: _fw("swot", "SWOT Analysis", "business", "swot", [
    { title: "Strengths", items: ["Strong brand", "Loyal customers", "Skilled team"] },
    { title: "Weaknesses", items: ["High costs", "Limited reach", "Old tech"] },
    { title: "Opportunities", items: ["New markets", "Partnerships", "Automation"] },
    { title: "Threats", items: ["New competitors", "Regulation", "Price wars"] },
  ]),
  pestle: _fw("pestle", "PESTLE Analysis", "business", "pestle", [
    { title: "Political", items: ["Policy", "Stability"] },
    { title: "Economic", items: ["Growth", "Inflation"] },
    { title: "Social", items: ["Demographics", "Trends"] },
    { title: "Technological", items: ["Innovation", "Automation"] },
    { title: "Legal", items: ["Compliance", "Labour law"] },
    { title: "Environmental", items: ["Climate", "Sustainability"] },
  ]),
  bcgmatrix: _fw("bcgmatrix", "BCG Matrix", "business", "bcg", [
    { title: "Stars", items: ["High growth, high share"] },
    { title: "Question Marks", items: ["High growth, low share"] },
    { title: "Cash Cows", items: ["Low growth, high share"] },
    { title: "Dogs", items: ["Low growth, low share"] },
  ]),
  portersfiveforces: _fw("portersfiveforces", "Porter's Five Forces", "business", "forces", [
    { title: "Competitive Rivalry", items: ["Many rivals"] },
    { title: "New Entrants", items: ["Low barriers"] },
    { title: "Supplier Power", items: ["Few suppliers"] },
    { title: "Buyer Power", items: ["Price sensitive"] },
    { title: "Substitutes", items: ["Alternatives exist"] },
  ]),
  businessmodelcanvas: _fw("businessmodelcanvas", "Business Model Canvas", "business", "canvas", [
    { title: "Key Partners", items: [] }, { title: "Key Activities", items: [] }, { title: "Value Propositions", items: [] },
    { title: "Customer Relationships", items: [] }, { title: "Customer Segments", items: [] }, { title: "Key Resources", items: [] },
    { title: "Channels", items: [] }, { title: "Cost Structure", items: [] }, { title: "Revenue Streams", items: [] },
  ], { cols: 3 }),
  valuechain: _fw("valuechain", "Value Chain", "business", "grid", [
    { title: "Inbound Logistics", items: [] }, { title: "Operations", items: [] }, { title: "Outbound Logistics", items: [] },
    { title: "Marketing & Sales", items: [] }, { title: "Service", items: [] },
  ], { cols: 5, rows: 1 }),
  comparisonchart: _fw("comparisonchart", "Comparison Chart", "education", "grid", [
    { title: "Option A", items: ["Pro: fast", "Con: costly"] },
    { title: "Option B", items: ["Pro: cheap", "Con: slower"] },
  ], { cols: 2, rows: 1 }),
  cyclediagram: _fw("cyclediagram", "Cycle Diagram", "education", "cycle", [
    { title: "Plan" }, { title: "Do" }, { title: "Check" }, { title: "Act" },
  ]),
  causeeffect: _fw("causeeffect", "Cause & Effect", "education", "grid", [
    { title: "Cause 1", items: [] }, { title: "Cause 2", items: [] }, { title: "Effect", items: [] },
  ], { cols: 3, rows: 1 }),
});

// ---- Phase 7: maps (Leaflet engine) + geography quick-wins -----------------
const _map = (type, label, category, map) => ({ label, category, engine: "leaflet", sample: { type, title: label, map } });
const _cities = [{ lat: 28.6, lng: 77.2, label: "Delhi" }, { lat: 19.1, lng: 72.9, label: "Mumbai" }, { lat: 13.1, lng: 80.3, label: "Chennai" }, { lat: 22.6, lng: 88.4, label: "Kolkata" }];

Object.assign(MODULES, {
  map:          _map("map", "Map", "geography", { center: [20.6, 78.9], zoom: 4, markers: _cities }),
  choropleth:   _map("choropleth", "Choropleth (value markers)", "geography", { center: [20.6, 78.9], zoom: 4, scale: 4, markers: [{ lat: 28.6, lng: 77.2, label: "North · 90", value: 90 }, { lat: 19.1, lng: 72.9, label: "West · 70", value: 70 }, { lat: 13.1, lng: 80.3, label: "South · 55", value: 55 }, { lat: 22.6, lng: 88.4, label: "East · 40", value: 40 }] }),
  flowmap:      _map("flowmap", "Flow Map", "geography", { center: [20.6, 78.9], zoom: 4, markers: _cities, lines: [{ from: [28.6, 77.2], to: [19.1, 72.9] }, { from: [28.6, 77.2], to: [13.1, 80.3] }, { from: [28.6, 77.2], to: [22.6, 88.4] }] }),
  // Geography quick-wins on existing engines
  windrose:     _plotly("windrose", "Wind Rose", "geography", [{ type: "barpolar", r: [20, 15, 30, 10, 25, 18, 12, 22], theta: ["N", "NE", "E", "SE", "S", "SW", "W", "NW"], marker: { color: "#2563eb" } }], { polar: { radialaxis: { ticksuffix: "%" } } }),
  rainfallgraph: _bar("rainfallgraph", "Rainfall Graph", "geography", ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"], [{ name: "Rainfall (mm)", data: [40, 35, 50, 60, 90, 120, 160, 150, 100, 70, 50, 45] }]),
  topographicprofile: _line("topographicprofile", "Topographic Profile", "geography", _range(0, 10, 1), [{ name: "Elevation (m)", data: [200, 350, 500, 720, 650, 800, 900, 750, 600, 400, 250] }], { beginAtZero: true, smooth: true }),
  elevation:    _line("elevation", "Elevation Profile", "geography", _range(0, 10, 1), [{ name: "Elevation (m)", data: [100, 180, 300, 420, 500, 610, 540, 400, 300, 220, 150] }], { beginAtZero: true, smooth: true }),
});

// Chart.js chart types the ChartRenderer knows how to build.
export const CHARTJS_TYPES = new Set(["bar", "line", "pie", "doughnut", "scatter", "bubble", "radar", "polarArea"]);

// ---- Phase 8: data-driven science & math illustrations (SVG engine) --------
const _sci = (type, label, category, science) => ({ label, category, engine: "science", sample: { type, title: label, science } });

Object.assign(MODULES, {
  bohrmodel:            _sci("bohrmodel", "Bohr Model", "chemistry", { kind: "bohr", symbol: "Na", protons: 11, neutrons: 12, shells: [2, 8, 1] }),
  atomicstructure:      _sci("atomicstructure", "Atomic Structure", "chemistry", { kind: "bohr", symbol: "O", protons: 8, neutrons: 8, shells: [2, 6] }),
  electronconfiguration: _sci("electronconfiguration", "Electron Configuration", "chemistry", { kind: "bohr", symbol: "Cl", protons: 17, neutrons: 18, shells: [2, 8, 7] }),
  energylevel:          _sci("energylevel", "Energy Level Diagram", "chemistry", { kind: "energy", levels: [{ label: "n=1", energy: -13.6 }, { label: "n=2", energy: -3.4 }, { label: "n=3", energy: -1.51 }, { label: "n=4", energy: -0.85 }], transitions: [{ from: 1, to: 0 }, { from: 2, to: 1 }] }),
  energydiagram:        _sci("energydiagram", "Energy Diagram", "physics", { kind: "energy", levels: [{ label: "Ground", energy: 0 }, { label: "Excited 1", energy: 2.1 }, { label: "Excited 2", energy: 3.4 }] }),
  freebodydiagram:      _sci("freebodydiagram", "Free Body Diagram", "physics", { kind: "freebody", label: "Block", forces: [{ label: "Weight", angle: 270, magnitude: 60 }, { label: "Normal", angle: 90, magnitude: 60 }, { label: "Applied", angle: 0, magnitude: 50 }, { label: "Friction", angle: 180, magnitude: 25 }] }),
  numberline:           _sci("numberline", "Number Line", "math", { kind: "numberline", min: -5, max: 5, step: 1, points: [{ x: 2, label: "A" }, { x: -3, label: "B" }], intervals: [{ from: 1, to: 4 }] }),
  coordinateplane:      _sci("coordinateplane", "Coordinate Plane", "math", { kind: "coordinate", min: -10, max: 10, points: [{ x: 3, y: 4, label: "P" }, { x: -5, y: -2, label: "Q" }], lines: [{ label: "y=x", points: [{ x: -8, y: -8 }, { x: 8, y: 8 }] }] }),
});

// ---- Phase 9: curated science illustrations (SVG engine) -------------------
const _il = (type, label, category, illustration) => ({ label, category, engine: "illustration", sample: { type, title: label, illustration } });
const _chem = (type, label, category, chem) => ({ label, category, engine: "chem", sample: { type, title: chem.title || label, chem } });

Object.assign(MODULES, {
  wave:              _il("wave", "Wave", "physics", { kind: "wave", amplitude: 90, wavelength: 200, cycles: 2 }),
  projectilemotion:  _il("projectilemotion", "Projectile Motion", "physics", { kind: "projectile", angle: 45, speed: 20 }),
  circuitdiagram:    _il("circuitdiagram", "Circuit Diagram", "physics", { kind: "circuit", components: [{ type: "battery", label: "9V" }, { type: "switch", label: "S" }, { type: "resistor", label: "R" }, { type: "bulb", label: "Lamp" }] }),
  raydiagram:        _il("raydiagram", "Ray Diagram", "physics", { kind: "ray", lens: "convex", focalLength: 3, objectDistance: 6, objectHeight: 2 }),
  optics:            _il("optics", "Optics", "physics", { kind: "ray", lens: "convex", focalLength: 3, objectDistance: 8, objectHeight: 2 }),
  electricfield:     _il("electricfield", "Electric Field", "physics", { kind: "efield", charges: [{ x: -0.5, q: 1 }, { x: 0.5, q: -1 }] }),
  magneticfield:     _il("magneticfield", "Magnetic Field", "physics", { kind: "bmagnet" }),
  molecularstructure:_il("molecularstructure", "Molecular Structure", "chemistry", { kind: "molecule", atoms: [{ el: "O", x: 0, y: 0 }, { el: "H", x: -1, y: 0.8 }, { el: "H", x: 1, y: 0.8 }], bonds: [{ a: 0, b: 1 }, { a: 0, b: 2 }] }),
  reactiondiagram:   _il("reactiondiagram", "Reaction Diagram", "chemistry", { kind: "reaction", reactants: 40, products: 15, activationEnergy: 60, exothermic: true }),
  orbitaldiagram:    _il("orbitaldiagram", "Orbital Diagram", "chemistry", { kind: "orbital", subshells: [{ label: "1s", electrons: 2, capacity: 2 }, { label: "2s", electrons: 2, capacity: 2 }, { label: "2p", electrons: 4, capacity: 6 }] }),
  dna:               _il("dna", "DNA", "biology", { kind: "dna", sequence: "ATGCGATCGT" }),
  rna:               _il("rna", "RNA", "biology", { kind: "rna", sequence: "AUGCGAUCGU" }),
  cellstructure:     _il("cellstructure", "Cell Structure", "biology", { kind: "cell", type: "animal" }),
  animalcell:        _il("animalcell", "Animal Cell", "biology", { kind: "cell", type: "animal" }),
  plantcell:         _il("plantcell", "Plant Cell", "biology", { kind: "cell", type: "plant" }),
});

// ---- Phase 10: fill remaining catalog (aliases + charts/graphs/tables/illustrations) ----
Object.assign(MODULES, {
  // pure chart-type aliases (renderers already exist under short slugs)
  barchart: MODULES.bar, linechart: MODULES.line, splinechart: MODULES.spline, stepchart: MODULES.step,
  areachart: MODULES.area, piechart: MODULES.pie, donutchart: MODULES.donut, scatterplot: MODULES.scatter,
  bubblechart: MODULES.bubble, radarchart: MODULES.radar, polarchart: MODULES.polar,

  // charts
  pareto:          _bar("pareto", "Pareto Chart", "charts", ["A", "B", "C", "D", "E"], [{ name: "Frequency", data: [40, 25, 15, 12, 8] }]),
  calendarheatmap: _plotly("calendarheatmap", "Calendar Heatmap", "charts", [{ z: [[1, 3, 2, 5, 0, 1, 4], [2, 4, 1, 0, 3, 5, 2], [0, 1, 5, 4, 2, 3, 1], [3, 2, 4, 1, 5, 0, 2], [1, 4, 2, 3, 0, 5, 1]], x: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], y: ["W1", "W2", "W3", "W4", "W5"], type: "heatmap", colorscale: "Greens" }]),
  chorddiagram:    _graph("chorddiagram", "Chord Diagram", "charts", [{ id: "A" }, { id: "B" }, { id: "C" }, { id: "D" }, { id: "E" }], [{ source: "A", target: "C" }, { source: "A", target: "D" }, { source: "B", target: "D" }, { source: "B", target: "E" }, { source: "C", target: "E" }, { source: "A", target: "B" }], "circle", false),
  alluvial:        _plotly("alluvial", "Alluvial Diagram", "charts", [{ type: "sankey", orientation: "h", node: { label: ["Group A", "Group B", "Stage 1", "Stage 2", "Outcome X", "Outcome Y"], pad: 15, thickness: 16 }, link: { source: [0, 0, 1, 1, 2, 3], target: [2, 3, 2, 3, 4, 5], value: [5, 3, 2, 6, 7, 9] } }]),

  // math
  cartesiangraph:  _line("cartesiangraph", "Cartesian Graph", "math", _X, [{ name: "y = x", data: _X.map((x) => x) }, { name: "y = 2x+1", data: _X.map((x) => 2 * x + 1) }], { beginAtZero: false, smooth: false }),
  hyperbola:       _scatter("hyperbola", "Hyperbola (y=1/x)", "math", [{ name: "branch +", data: _range(0.5, 5, 0.25).map((x) => ({ x, y: Math.round(100 / x) / 100 })), line: true }, { name: "branch −", data: _range(-5, -0.5, 0.25).map((x) => ({ x, y: Math.round(100 / x) / 100 })), line: true }]),
  polargraph:      _scatter("polargraph", "Polar Graph (rose)", "math", [{ name: "r = cos(2θ)", data: _range(0, 360, 5).map((d) => { const t = (d * Math.PI) / 180, r = Math.cos(2 * t); return { x: Math.round(r * Math.cos(t) * 100) / 100, y: Math.round(r * Math.sin(t) * 100) / 100 }; }), line: true }]),
  implicitfunction:_scatter("implicitfunction", "Implicit: x²+y²=16", "math", [{ name: "circle", data: _range(0, 360, 10).map((d) => { const t = (d * Math.PI) / 180; return { x: Math.round(4 * Math.cos(t) * 100) / 100, y: Math.round(4 * Math.sin(t) * 100) / 100 }; }), line: true }]),
  limit:           _line("limit", "Limit of (x²−1)/(x−1) → 2", "math", _range(-2, 4, 0.5), [{ name: "f(x) = x+1", data: _range(-2, 4, 0.5).map((x) => x + 1) }], { beginAtZero: false, smooth: false }),
  taylorseries:    _line("taylorseries", "Taylor Series of sin(x)", "math", _range(-3, 3, 0.5), [{ name: "sin x", data: _range(-3, 3, 0.5).map((x) => Math.round(Math.sin(x) * 100) / 100) }, { name: "x", data: _range(-3, 3, 0.5).map((x) => Math.round(x * 100) / 100) }, { name: "x − x³/6", data: _range(-3, 3, 0.5).map((x) => Math.round((x - x ** 3 / 6) * 100) / 100) }], { beginAtZero: false }),
  complexplane:    _scatter("complexplane", "Complex Plane", "math", [{ name: "points", data: [{ x: 2, y: 3 }, { x: -1, y: 2 }, { x: -2, y: -1 }, { x: 3, y: -2 }] }]),
  vectorfield:     _il("vectorfield", "Vector Field", "math", { kind: "field", type: "vector" }),
  slopefield:      _il("slopefield", "Slope Field", "math", { kind: "field", type: "slope" }),

  // statistics
  samplingdistribution: _line("samplingdistribution", "Sampling Distribution", "statistics", _range(-4, 4, 0.5), [{ name: "x̄ distribution", data: _range(-4, 4, 0.5).map((x) => Math.round(Math.exp((-x * x) / 0.5) * 1000) / 1000) }], { beginAtZero: true }),
  multipleregression:   _scatter("multipleregression", "Multiple Regression (fit)", "statistics", [{ name: "Observed", data: [{ x: 1, y: 2.2 }, { x: 2, y: 3.1 }, { x: 3, y: 3.9 }, { x: 4, y: 5.2 }, { x: 5, y: 5.8 }, { x: 6, y: 7.1 }] }, { name: "Predicted", data: [{ x: 1, y: 2.1 }, { x: 6, y: 7.0 }], line: true }]),
  qqplot:          _scatter("qqplot", "Q–Q Plot", "statistics", [{ name: "Quantiles", data: [{ x: -2, y: -1.8 }, { x: -1, y: -1.1 }, { x: -0.5, y: -0.4 }, { x: 0, y: 0.1 }, { x: 0.5, y: 0.6 }, { x: 1, y: 1.2 }, { x: 2, y: 1.9 }] }, { name: "y = x", data: [{ x: -2, y: -2 }, { x: 2, y: 2 }], line: true }]),
  stemleaf:        _il("stemleaf", "Stem & Leaf Plot", "statistics", { kind: "table", headers: ["Stem", "Leaves"], rows: [["1", "2 5 7"], ["2", "0 3 3 8"], ["3", "1 4 6 6 9"], ["4", "2 5"]] }),
  anova:           _bar("anova", "ANOVA (group means)", "statistics", ["Group A", "Group B", "Group C"], [{ name: "Mean", data: [52, 61, 47] }]),

  // economics
  productionfunction: _line("productionfunction", "Production Function", "economics", _range(0, 10, 1), [{ name: "Output Q", data: _range(0, 10, 1).map((l) => Math.round(20 * Math.sqrt(l))) }], { beginAtZero: true }),
  isoquant:        _line("isoquant", "Isoquant Map", "economics", _range(1, 10, 1), [{ name: "Q=20", data: _range(1, 10, 1).map((l) => Math.round(20 / l)) }, { name: "Q=40", data: _range(1, 10, 1).map((l) => Math.round(40 / l)) }], { beginAtZero: true }),
  isocost:         _line("isocost", "Isocost Line", "economics", _range(0, 10, 2), [{ name: "C₁", data: [10, 8, 6, 4, 2, 0] }, { name: "C₂", data: [15, 12, 9, 6, 3, 0] }], { beginAtZero: true, smooth: false }),
  monopoly:        _line("monopoly", "Monopoly", "economics", _range(1, 10, 1), [{ name: "Demand (AR)", data: _range(1, 10, 1).map((q) => Math.max(0, 20 - 1.5 * q)) }, { name: "MR", data: _range(1, 10, 1).map((q) => 20 - 3 * q) }, { name: "MC", data: _range(1, 10, 1).map((q) => Math.round((4 + 0.8 * q) * 10) / 10) }, { name: "ATC", data: [18, 11, 9, 8, 8, 8.5, 9.5, 11, 13, 15] }], { beginAtZero: false }),
  oligopoly:       _line("oligopoly", "Kinked Demand (Oligopoly)", "economics", _range(1, 10, 1), [{ name: "Demand", data: [19, 17, 15, 13, 11, 8, 5, 2, 0, 0] }, { name: "MR", data: [18, 15, 12, 9, 6, 0, -4, -8, -12, -16] }], { beginAtZero: false, smooth: false }),
  gametheory:      _il("gametheory", "Game Theory (payoff matrix)", "economics", { kind: "table", headers: ["", "Left", "Right"], rows: [["Up", "3, 3", "0, 5"], ["Down", "5, 0", "1, 1"]] }),
  circularflow:    _graph("circularflow", "Circular Flow of Income", "economics", [{ id: "Households" }, { id: "Firms" }, { id: "Govt" }, { id: "Banks" }], [{ source: "Households", target: "Firms", label: "Spending" }, { source: "Firms", target: "Households", label: "Wages" }, { source: "Households", target: "Banks", label: "Savings" }, { source: "Banks", target: "Firms", label: "Investment" }, { source: "Households", target: "Govt", label: "Taxes" }, { source: "Govt", target: "Households", label: "Services" }], "circle", true),
  businesscycle:   _line("businesscycle", "Business Cycle", "economics", _range(0, 12, 1), [{ name: "GDP", data: _range(0, 12, 1).map((t) => Math.round((100 + 15 * Math.sin(t / 2)) * 10) / 10) }, { name: "Trend", data: _range(0, 12, 1).map((t) => 100 + t * 0.5) }], { beginAtZero: false }),
  solowgrowth:     _line("solowgrowth", "Solow Growth Model", "economics", _range(0, 10, 1), [{ name: "Output f(k)", data: _range(0, 10, 1).map((k) => Math.round(10 * Math.sqrt(k))) }, { name: "Investment sf(k)", data: _range(0, 10, 1).map((k) => Math.round(4 * Math.sqrt(k))) }, { name: "Depreciation δk", data: _range(0, 10, 1).map((k) => Math.round(k * 1.2 * 10) / 10) }], { beginAtZero: true }),
  comparativeadvantage: _line("comparativeadvantage", "Comparative Advantage (PPF)", "economics", _range(0, 10, 2), [{ name: "Country A", data: [20, 16, 12, 8, 4, 0] }, { name: "Country B", data: [10, 8, 6, 4, 2, 0] }], { beginAtZero: true, smooth: false }),
  trademodels:     _line("trademodels", "Trade Model", "economics", _Q, [{ name: "Domestic Demand", data: [100, 80, 60, 40, 20, 0] }, { name: "Domestic Supply", data: [0, 20, 40, 60, 80, 100] }, { name: "World Price", data: [30, 30, 30, 30, 30, 30] }], { beginAtZero: true, smooth: false }),
  exchangerate:    _line("exchangerate", "Exchange Rate (FX market)", "economics", _range(0, 100, 20), [{ name: "Demand for $", data: [100, 80, 60, 40, 20, 0] }, { name: "Supply of $", data: [0, 20, 40, 60, 80, 100] }], { beginAtZero: true, smooth: false }),
  moneymultiplier: _bar("moneymultiplier", "Money Multiplier", "economics", ["R1", "R2", "R3", "R4", "R5", "R6"], [{ name: "New deposits", data: [100, 80, 64, 51.2, 41, 32.8] }]),

  // accounting & finance
  balancesheet:    _il("balancesheet", "Balance Sheet", "finance", { kind: "table", headers: ["Assets", "Liabilities & Equity"], rows: [["Cash 20k", "Payables 15k"], ["Inventory 30k", "Loans 40k"], ["Equipment 50k", "Equity 45k"], ["Total 100k", "Total 100k"]] }),
  incomestatement: _plotly("incomestatement", "Income Statement", "finance", [{ type: "waterfall", x: ["Revenue", "COGS", "Gross", "OpEx", "Op Income", "Tax", "Net Income"], measure: ["absolute", "relative", "total", "relative", "total", "relative", "total"], y: [200, -120, 0, -40, 0, -12, 0] }]),
  cashflow:        _plotly("cashflow", "Cash Flow Statement", "finance", [{ type: "waterfall", x: ["Start", "Operating", "Investing", "Financing", "End"], measure: ["absolute", "relative", "relative", "relative", "total"], y: [50, 40, -30, 15, 0] }]),
  ledger:          _il("ledger", "Ledger (T-account)", "finance", { kind: "table", headers: ["Debit", "Credit"], rows: [["Cash 5,000", ""], ["", "Sales 5,000"], ["Rent 1,200", ""], ["", "Cash 1,200"]] }),
  journalflow:     _graph("journalflow", "Journal → Ledger Flow", "finance", [{ id: "Transaction" }, { id: "Journal" }, { id: "Ledger" }, { id: "Trial Balance" }, { id: "Statements" }], _chain(["Transaction", "Journal", "Ledger", "Trial Balance", "Statements"]), "grid", true),
  trialbalance:    _il("trialbalance", "Trial Balance", "finance", { kind: "table", headers: ["Account", "Debit", "Credit"], rows: [["Cash", "5000", ""], ["Sales", "", "8000"], ["Rent", "1200", ""], ["Capital", "", "3000"], ["Purchases", "4800", ""], ["Total", "11000", "11000"]] }),
  npv:             _bar("npv", "NPV (discounted cash flows)", "finance", ["Y0", "Y1", "Y2", "Y3", "Y4"], [{ name: "Discounted CF", data: [-100, 45, 38, 30, 22] }]),
  irr:             _line("irr", "IRR (NPV vs discount rate)", "finance", _range(0, 20, 2), [{ name: "NPV", data: [60, 42, 27, 15, 5, -3, -10, -16, -21, -25, -28] }], { beginAtZero: false }),
  stockanalysis:   _plotly("stockanalysis", "Stock Analysis", "finance", [{ type: "candlestick", x: ["Mon", "Tue", "Wed", "Thu", "Fri", "Mon", "Tue", "Wed"], open: [100, 104, 102, 108, 110, 107, 112, 115], high: [106, 108, 107, 112, 114, 113, 117, 120], low: [98, 101, 100, 105, 108, 105, 110, 113], close: [104, 102, 108, 110, 107, 112, 115, 118] }]),
  macd:            _line("macd", "MACD", "finance", _range(1, 12, 1), [{ name: "MACD", data: [0.2, 0.5, 0.8, 0.6, 0.3, -0.1, -0.4, -0.2, 0.1, 0.4, 0.7, 0.9] }, { name: "Signal", data: [0.1, 0.3, 0.6, 0.65, 0.5, 0.2, -0.1, -0.2, -0.05, 0.2, 0.5, 0.75] }], { beginAtZero: false }),
  rsi:             _line("rsi", "RSI (14)", "finance", _range(1, 14, 1), [{ name: "RSI", data: [45, 52, 60, 68, 74, 71, 66, 58, 49, 42, 38, 44, 55, 63] }, { name: "Overbought 70", data: Array(14).fill(70) }, { name: "Oversold 30", data: Array(14).fill(30) }], { beginAtZero: true, smooth: false }),

  // geography
  riversystem:     _graph("riversystem", "River System", "geography", [{ id: "Source" }, { id: "Trib A" }, { id: "Trib B" }, { id: "Main" }, { id: "Trib C" }, { id: "Mouth" }], [{ source: "Source", target: "Main" }, { source: "Trib A", target: "Main" }, { source: "Trib B", target: "Main" }, { source: "Main", target: "Trib C" }, { source: "Trib C", target: "Mouth" }, { source: "Main", target: "Mouth" }], "breadthfirst", true),
  drainagepattern: _graph("drainagepattern", "Drainage Pattern (dendritic)", "geography", [{ id: "Main" }, { id: "B1" }, { id: "B2" }, { id: "B3" }, { id: "B4" }, { id: "C1" }, { id: "C2" }], [{ source: "B1", target: "Main" }, { source: "B2", target: "Main" }, { source: "B3", target: "B1" }, { source: "B4", target: "B2" }, { source: "C1", target: "B3" }, { source: "C2", target: "B4" }], "breadthfirst", true),
  contourdiagram:  _plotly("contourdiagram", "Contour Diagram", "geography", [{ type: "contour", z: [[10, 20, 30, 25, 15], [20, 40, 55, 45, 25], [30, 55, 80, 60, 35], [25, 45, 60, 50, 30], [15, 25, 35, 30, 20]], colorscale: "Earth", contours: { coloring: "heatmap" } }]),
  dem:             _plotly("dem", "Digital Elevation Model", "geography", [{ type: "surface", z: [[1, 2, 3, 4, 3], [2, 4, 6, 5, 3], [3, 6, 9, 7, 4], [2, 5, 7, 5, 3], [1, 3, 4, 3, 2]], colorscale: "Earth" }]),
  terrain:         _plotly("terrain", "Terrain (3D)", "geography", [{ type: "surface", z: [[2, 3, 5, 4, 2], [3, 6, 8, 6, 3], [5, 8, 12, 9, 5], [4, 6, 9, 7, 4], [2, 3, 5, 4, 2]], colorscale: "Earth" }]),

  // biology
  mitosis:         _il("mitosis", "Mitosis", "biology", { kind: "celldivision", process: "mitosis" }),
  meiosis:         _il("meiosis", "Meiosis", "biology", { kind: "celldivision", process: "meiosis" }),
  humanbody:       _il("humanbody", "Human Body", "biology", { kind: "humanbody" }),
  ecosystem:       _graph("ecosystem", "Ecosystem", "biology", [{ id: "Sun" }, { id: "Plants" }, { id: "Herbivores" }, { id: "Carnivores" }, { id: "Decomposers" }], [{ source: "Sun", target: "Plants" }, { source: "Plants", target: "Herbivores" }, { source: "Herbivores", target: "Carnivores" }, { source: "Carnivores", target: "Decomposers" }, { source: "Herbivores", target: "Decomposers" }, { source: "Decomposers", target: "Plants" }], "circle", true),

  // chemistry
  periodictable:   _il("periodictable", "Periodic Table", "chemistry", { kind: "periodictable", highlight: ["Na", "Cl", "O", "H", "Fe"] }),
  // Organic reaction mechanisms — real 2D structures from SMILES (OpenChemLib).
  reactionmechanism:      _chem("reactionmechanism", "Reaction Mechanism", "chemistry", {
    title: "Substitution (SN1): t-BuOH + HCl", electrons: [{ step: 1, from: [0.7, 0.35], to: [0.5, 0.5] }],
    steps: [{ smiles: "CC(C)(C)O", label: "t-butanol" }, { smiles: "C[C+](C)C", label: "carbocation", bracket: true, charge: "+" }, { smiles: "CC(C)(C)Cl", label: "t-butyl chloride" }],
    arrows: [{ type: "equilibrium", top: "HCl", bottom: "− H₂O" }, { type: "equilibrium", top: "Cl⁻" }],
  }),
  substitutionmechanism:  _chem("substitutionmechanism", "Substitution Mechanism", "chemistry", {
    title: "Nucleophilic Substitution", electrons: [{ step: 1, from: [0.72, 0.35], to: [0.5, 0.5] }],
    steps: [{ smiles: "CC(C)(C)O", label: "substrate" }, { smiles: "C[C+](C)C", label: "carbocation", bracket: true, charge: "+" }, { smiles: "CC(C)(C)Cl", label: "product" }],
    arrows: [{ type: "equilibrium", top: "HCl", bottom: "− H₂O" }, { type: "equilibrium", top: "Cl⁻ (nucleophile)" }],
  }),
  additionmechanism:      _chem("additionmechanism", "Addition Mechanism", "chemistry", {
    title: "Electrophilic Addition: ethene + HBr", electrons: [{ step: 0, from: [0.5, 0.3], to: [0.35, 0.5] }, { step: 1, from: [0.7, 0.4], to: [0.5, 0.5] }],
    steps: [{ smiles: "C=C", label: "ethene" }, { smiles: "C[CH2+]", label: "carbocation", bracket: true, charge: "+" }, { smiles: "CCBr", label: "bromoethane" }],
    arrows: [{ type: "forward", top: "H⁺ (from HBr)" }, { type: "forward", top: "Br⁻ (nucleophile)" }],
  }),
  eliminationmechanism:   _chem("eliminationmechanism", "Elimination Mechanism", "chemistry", {
    title: "Elimination (E2): t-BuCl + KOH", byproducts: ["H₂O", "KCl"],
    steps: [{ smiles: "CC(C)(C)Cl", label: "t-butyl chloride" }, { smiles: "C=C(C)C", label: "2-methylpropene" }],
    arrows: [{ type: "forward", top: "KOH" }],
  }),
  rearrangementmechanism: _chem("rearrangementmechanism", "Rearrangement Mechanism", "chemistry", {
    title: "Keto–Enol Tautomerism",
    steps: [{ smiles: "CC(=O)C", label: "keto tautomer" }, { smiles: "C=C(O)C", label: "enol tautomer" }],
    arrows: [{ type: "equilibrium" }],
  }),
  // All four reaction types stacked in a single figure (like a textbook plate).
  combinedmechanisms: _chem("combinedmechanisms", "Combined Mechanisms", "chemistry", {
    overallTitle: "Organic Reaction Mechanisms",
    sections: [
      { title: "Substitution", steps: [{ smiles: "CC(C)(C)O", label: "t-butanol" }, { smiles: "C[C+](C)C", label: "carbocation", bracket: true, charge: "+" }, { smiles: "CC(C)(C)Cl", label: "t-butyl chloride" }], arrows: [{ type: "equilibrium", top: "HCl", bottom: "− H₂O" }, { type: "equilibrium", top: "Cl⁻" }] },
      { title: "Addition", steps: [{ smiles: "C=C", label: "ethene" }, { smiles: "C[CH2+]", label: "carbocation", bracket: true, charge: "+" }, { smiles: "CCBr", label: "bromoethane" }], arrows: [{ type: "forward", top: "H⁺ (from HBr)" }, { type: "forward", top: "Br⁻" }] },
      { title: "Elimination", steps: [{ smiles: "CC(C)(C)Cl", label: "t-butyl chloride" }, { smiles: "C=C(C)C", label: "2-methylpropene" }], arrows: [{ type: "forward", top: "KOH (base)", bottom: "− H₂O, − KCl" }] },
      { title: "Rearrangement (tautomerism)", steps: [{ smiles: "CC(=O)C", label: "keto" }, { smiles: "C=C(O)C", label: "enol" }], arrows: [{ type: "equilibrium" }] },
    ],
  }),

  // computer science
  dfd:             _graph("dfd", "Data Flow Diagram", "cs", [{ id: "User" }, { id: "Process 1" }, { id: "Data Store" }, { id: "Process 2" }, { id: "Report" }], [{ source: "User", target: "Process 1", label: "input" }, { source: "Process 1", target: "Data Store", label: "write" }, { source: "Data Store", target: "Process 2", label: "read" }, { source: "Process 2", target: "Report", label: "output" }], "breadthfirst", true),
  architecturediagram: _graph("architecturediagram", "Architecture Diagram", "cs", [{ id: "Client" }, { id: "CDN" }, { id: "API Gateway" }, { id: "Service" }, { id: "Database" }, { id: "Cache" }], [{ source: "Client", target: "CDN" }, { source: "CDN", target: "API Gateway" }, { source: "API Gateway", target: "Service" }, { source: "Service", target: "Database" }, { source: "Service", target: "Cache" }], "breadthfirst", true),
  networkdiagram:  _graph("networkdiagram", "Network Diagram", "cs", [{ id: "Internet" }, { id: "Router" }, { id: "Switch" }, { id: "Server" }, { id: "PC 1" }, { id: "PC 2" }], [{ source: "Internet", target: "Router" }, { source: "Router", target: "Switch" }, { source: "Switch", target: "Server" }, { source: "Switch", target: "PC 1" }, { source: "Switch", target: "PC 2" }], "breadthfirst", false),
  apiflow:         _graph("apiflow", "API Flow", "cs", [{ id: "Client" }, { id: "Auth" }, { id: "API" }, { id: "DB" }, { id: "Response" }], _chain(["Client", "Auth", "API", "DB", "Response"]), "grid", true),
  databaseschema:  _graph("databaseschema", "Database Schema", "cs", [{ id: "users" }, { id: "orders" }, { id: "products" }, { id: "order_items" }], [{ source: "users", target: "orders", label: "1:N" }, { source: "orders", target: "order_items", label: "1:N" }, { source: "products", target: "order_items", label: "1:N" }], "cose", true),
  fsm:             _graph("fsm", "Finite State Machine", "cs", [{ id: "Start" }, { id: "Idle" }, { id: "Running" }, { id: "Paused" }, { id: "Done" }], [{ source: "Start", target: "Idle" }, { source: "Idle", target: "Running", label: "play" }, { source: "Running", target: "Paused", label: "pause" }, { source: "Paused", target: "Running", label: "resume" }, { source: "Running", target: "Done", label: "finish" }], "breadthfirst", true),

  // business & education
  fishbone:        _il("fishbone", "Fishbone Diagram", "business", { kind: "fishbone", effect: "Low Quality", causes: [{ category: "People", items: ["Training", "Fatigue"] }, { category: "Process", items: ["No checks"] }, { category: "Machine", items: ["Wear"] }, { category: "Material", items: ["Defects"] }, { category: "Method", items: ["Unclear SOP"] }, { category: "Environment", items: ["Heat"] }] }),
  kanban:          _fw("kanban", "Kanban Board", "business", "grid", [{ title: "To Do", items: ["Design API", "Write specs", "Setup CI"] }, { title: "In Progress", items: ["Auth module", "Dashboard"] }, { title: "Done", items: ["Login page", "DB schema"] }], { cols: 3 }),
  roadmap:         _fw("roadmap", "Roadmap", "business", "grid", [{ title: "Q1", items: ["MVP", "Beta launch"] }, { title: "Q2", items: ["Mobile app", "Payments"] }, { title: "Q3", items: ["Analytics", "Scale"] }, { title: "Q4", items: ["Enterprise", "Global"] }], { cols: 4 }),
  flashcards:      _il("flashcards", "Flashcards", "education", { kind: "flashcards", cards: [{ front: "Capital of Japan?", back: "Tokyo" }, { front: "Speed of light?", back: "3×10⁸ m/s" }, { front: "Largest planet?", back: "Jupiter" }] }),
});

// Look up an implemented module by a type id (case-insensitive, de-slugged).
export function getModule(typeId) {
  if (!typeId) return null;
  const key = slug(typeId);
  return MODULES[key] || null;
}

// Is this diagram type renderable in the current build?
export const isImplemented = (typeId) => !!getModule(typeId);
