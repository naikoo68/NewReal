// Reusable seeding logic. Used by the CLI seed script (`npm run seed`) and by
// the server's auto-seed (runs once when the database is empty — handy on
// hosts like Render's free tier where shell access isn't available).
import User from "../models/User.js";
import Subject from "../models/Subject.js";
import Topic from "../models/Topic.js";
import Session from "../models/Session.js";
import Question from "../models/Question.js";
import TestSeries from "../models/TestSeries.js";
import Attempt from "../models/Attempt.js";

const slugify = (s) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const SUBJECTS = [
  { name: "Physics", icon: "Atom", color: "from-blue-500 to-indigo-600", description: "Mechanics, thermodynamics, optics and modern physics." },
  { name: "Chemistry", icon: "FlaskConical", color: "from-emerald-500 to-teal-600", description: "Physical, organic and inorganic chemistry essentials." },
  { name: "Biology", icon: "Dna", color: "from-green-500 to-lime-600", description: "Cell biology, genetics, human physiology and ecology." },
  { name: "Mathematics", icon: "Sigma", color: "from-violet-500 to-purple-600", description: "Algebra, calculus, trigonometry and statistics." },
  { name: "Economics", icon: "TrendingUp", color: "from-amber-500 to-orange-600", description: "Micro and macro economics with Indian economy." },
  { name: "Accountancy", icon: "Calculator", color: "from-rose-500 to-pink-600", description: "Financial statements, partnership and company accounts." },
  { name: "Business Studies", icon: "Briefcase", color: "from-sky-500 to-blue-600", description: "Management, marketing and business environment." },
  { name: "History", icon: "ScrollText", color: "from-yellow-600 to-amber-700", description: "Ancient, medieval and modern world history." },
  { name: "Geography", icon: "Globe2", color: "from-cyan-500 to-teal-600", description: "Physical, human and economic geography." },
  { name: "Political Science", icon: "Landmark", color: "from-indigo-500 to-blue-700", description: "Political theory, constitution and governance." },
  { name: "English", icon: "BookOpen", color: "from-fuchsia-500 to-purple-600", description: "Grammar, comprehension, writing and literature." },
  { name: "Computer Science", icon: "Cpu", color: "from-slate-600 to-slate-800", description: "Programming, data structures, networks and DBMS." },
];

const SESSION_TITLES = {
  Physics: ["Units & Measurements", "Motion", "Laws of Motion", "Work, Energy & Power", "Gravitation"],
  Chemistry: ["Some Basic Concepts", "Structure of Atom", "Chemical Bonding", "States of Matter", "Thermodynamics"],
  Biology: ["The Living World", "Cell: Unit of Life", "Plant Physiology", "Human Physiology", "Genetics & Evolution"],
  Mathematics: ["Sets & Relations", "Trigonometry", "Sequences & Series", "Limits & Derivatives", "Probability"],
  Economics: ["Introduction to Economics", "Consumer Equilibrium", "National Income", "Money & Banking"],
  Accountancy: ["Accounting Equation", "Journal & Ledger", "Depreciation", "Partnership Accounts"],
  "Business Studies": ["Nature of Management", "Principles of Management", "Business Environment", "Marketing Management"],
  History: ["Ancient Civilizations", "Medieval India", "Modern India", "World Wars"],
  Geography: ["The Earth & Landforms", "Climate & Weather", "Population", "Economic Geography"],
  "Political Science": ["Political Theory", "Indian Constitution", "Rights & Duties", "Federalism"],
  English: ["Grammar Basics", "Reading Comprehension", "Writing Skills", "Literature"],
  "Computer Science": ["Programming Fundamentals", "Data Structures", "Databases", "Computer Networks", "Operating Systems"],
};

const DIFFICULTIES = ["Easy", "Medium", "Hard"];

// Two topics per subject; the subject's sessions are split between them.
const TOPIC_NAMES = {
  Physics: ["Mechanics", "Modern Physics"],
  Chemistry: ["Physical Chemistry", "Organic & Inorganic"],
  Biology: ["Botany", "Zoology"],
  Mathematics: ["Algebra & Calculus", "Geometry & Statistics"],
  Economics: ["Microeconomics", "Macroeconomics"],
  Accountancy: ["Basic Accounting", "Company Accounts"],
  "Business Studies": ["Management", "Marketing & Environment"],
  History: ["Ancient & Medieval", "Modern World"],
  Geography: ["Physical Geography", "Human Geography"],
  "Political Science": ["Political Theory", "Indian Government"],
  English: ["Language & Grammar", "Literature & Writing"],
  "Computer Science": ["Programming & Data", "Systems & Networks"],
};

const CURATED = {
  "Units & Measurements": [
    { text: "Which of the following is a base SI unit?", options: ["Newton", "Kilogram", "Watt", "Pascal"], correct: 1, topic: "SI Units", explanation: "Kilogram is a base SI unit of mass. The others are derived units." },
    { text: "The dimensional formula of force is:", options: ["[MLT⁻¹]", "[MLT⁻²]", "[ML²T⁻²]", "[M⁰LT⁻²]"], correct: 1, topic: "Dimensions", explanation: "Force = mass × acceleration = [MLT⁻²]." },
    { text: "How many significant figures are in 0.00450?", options: ["2", "3", "4", "5"], correct: 1, topic: "Significant Figures", explanation: "Leading zeros are not significant → 4, 5, 0 = 3 significant figures." },
    { text: "One light year is a unit of:", options: ["Time", "Distance", "Speed", "Intensity"], correct: 1, topic: "Units", explanation: "A light year is the distance light travels in one year." },
  ],
};

function buildQuestions(sessionTitle) {
  const curated = CURATED[sessionTitle];
  const list = curated ? [...curated] : [];
  const need = 8 - list.length;
  for (let i = 0; i < need; i++) {
    list.push({
      text: `${sessionTitle} — concept check ${i + 1}: choose the correct statement.`,
      options: ["First option", "Second option", "Correct conceptual answer", "Distractor option"],
      correct: 2,
      topic: ["Core Concept", "Application", "Analysis"][i % 3],
      explanation: "Detailed solution. Admins can edit explanations, add images and references for each question.",
    });
  }
  return list.map((q, i) => ({ ...q, difficulty: DIFFICULTIES[i % 3], status: "published" }));
}

// Performs the full seed. Assumes mongoose is already connected.
// When `reset` is true, existing data is wiped first.
export async function seedDatabase({ reset = false } = {}) {
  if (reset) {
    await Promise.all([
      User.deleteMany({}),
      Subject.deleteMany({}),
      Topic.deleteMany({}),
      Session.deleteMany({}),
      Question.deleteMany({}),
      TestSeries.deleteMany({}),
      Attempt.deleteMany({}),
    ]);
  }

  const adminEmail = (process.env.ADMIN_EMAIL || "admin@mystudyguide.com").toLowerCase().trim();
  const adminPassword = process.env.ADMIN_PASSWORD || "admin123";
  await User.create({ name: "Admin", email: adminEmail, password: adminPassword, role: "admin", isEmailVerified: true });
  const student = await User.create({ name: "Demo Student", email: "student@mystudyguide.com", password: "student123", isEmailVerified: true, streak: 7, plan: "Premium" });

  const extraNames = ["Aarav Sharma", "Diya Patel", "Vihaan Gupta", "Ananya Reddy", "Kabir Singh"];
  await User.create(
    extraNames.map((name, i) => ({
      name,
      email: `${slugify(name)}@example.com`,
      password: "password123",
      isEmailVerified: true,
      plan: ["Free", "Premium", "Pro"][i % 3],
    }))
  );

  const createdQuestionsBySubject = {};
  for (const s of SUBJECTS) {
    const subject = await Subject.create({ ...s, slug: slugify(s.name) });
    const titles = SESSION_TITLES[s.name] || [];
    const topicNames = TOPIC_NAMES[s.name] || ["Core Concepts", "Advanced Topics"];
    createdQuestionsBySubject[s.name] = [];

    // Split the subject's sessions across its two topics.
    const mid = Math.ceil(titles.length / 2);
    const groups = [titles.slice(0, mid), titles.slice(mid)];

    for (let t = 0; t < topicNames.length; t++) {
      const groupTitles = groups[t] || [];
      if (!groupTitles.length) continue;
      const topic = await Topic.create({
        subject: subject._id,
        title: topicNames[t],
        index: t + 1,
      });
      for (let i = 0; i < groupTitles.length; i++) {
        const session = await Session.create({
          subject: subject._id,
          topic: topic._id,
          title: groupTitles[i],
          index: i + 1,
          difficulty: DIFFICULTIES[i % 3],
        });
        const qs = buildQuestions(groupTitles[i]).map((q) => ({
          ...q,
          subject: subject._id,
          session: session._id,
        }));
        const created = await Question.insertMany(qs);
        createdQuestionsBySubject[s.name].push(...created);
      }
    }
  }

  const allQuestions = Object.values(createdQuestionsBySubject).flat();
  const pick = (n) => allQuestions.slice(0, n).map((q) => q._id);

  const tests = await TestSeries.insertMany([
    { name: "JEE Main Full Mock Test 1", category: "Full-Length", duration: 180, marks: 120, difficulty: "Hard", questions: pick(30), status: "published", attempts: 12450 },
    { name: "NEET Biology Subject Test", category: "Subject-wise", duration: 90, marks: 80, difficulty: "Medium", questions: pick(20), status: "published", attempts: 8930 },
    { name: "Physics: Laws of Motion (Chapter Test)", category: "Chapter-wise", duration: 30, marks: 40, difficulty: "Medium", questions: pick(10), status: "published", attempts: 5120 },
    { name: "CBSE Class 12 Maths — 2024 PYQ", category: "Previous Year", duration: 180, marks: 80, difficulty: "Hard", questions: pick(15), status: "published", attempts: 6720 },
    { name: "Chemistry Full Syllabus Grand Test", category: "Full-Length", duration: 120, marks: 100, difficulty: "Hard", questions: pick(25), status: "published", attempts: 4310, schedule: new Date(Date.now() + 6 * 864e5) },
    { name: "Weekend Grand Test #6", category: "Full-Length", duration: 120, marks: 100, difficulty: "Medium", questions: pick(25), status: "scheduled", attempts: 0, schedule: new Date(Date.now() + 9 * 864e5) },
  ]);

  student.enrolledTests = [tests[0]._id, tests[1]._id, tests[4]._id];
  await student.save();

  const sampleAttempts = [
    { test: 0, correct: 22, total: 30, score: 80, pct: 73 },
    { test: 1, correct: 16, total: 20, score: 60, pct: 80 },
    { test: 4, correct: 20, total: 25, score: 78, pct: 84 },
  ];
  let day = 18;
  for (const a of sampleAttempts) {
    await Attempt.create({
      user: student._id,
      type: "test",
      testSeries: tests[a.test]._id,
      total: a.total,
      attempted: a.total,
      correct: a.correct,
      incorrect: a.total - a.correct,
      score: a.score,
      percentage: a.pct,
      timeTaken: 3600,
      createdAt: new Date(2026, 5, day),
    });
    day += 3;
  }

  return { admin: `${adminEmail} / ${adminPassword}`, student: "student@mystudyguide.com / student123" };
}

// Seeds only if the database has no users yet (safe to call on every boot).
export async function seedIfEmpty() {
  const count = await User.countDocuments();
  if (count > 0) return false;
  await seedDatabase({ reset: false });
  return true;
}
