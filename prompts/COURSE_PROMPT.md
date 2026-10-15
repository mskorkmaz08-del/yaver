# Build the Yaver Course: a day-by-day course in Python, C++, algorithms, math, AI and robotics

> **How to use this file.** Open this repo in Claude Code and say:
> *"Read `prompts/COURSE_PROMPT.md` and build everything in it, milestone by milestone."*
> It is written for a coding agent working in this repository. It is long on purpose: every decision you need is in here, so you shouldn't have to stop and ask. When something truly isn't covered, make the most reasonable choice, keep going, and list the choice in your final summary.

---

## 0. The outcome

Add a **Course** to Yaver that teaches its owner, Mustafa, day by day, the foundations he needs to become an expert-level **AI engineer** (data science, machine learning, deep learning) and **robotics engineer**.

He will use it on **both his iPhone and his laptop/desktop**: the same app at the same address, a layout made for each screen, and the same progress on both devices (§10b).

When he opens Yaver at 05:30, it must show exactly what to learn in each study block today, then **teach** it: a lesson of **at least 60 minutes** per subject block, built on proven learning methods (retrieval, spacing, interleaving, worked examples, practice at the edge, teaching back). It checks that he actually learned it, schedules reviews so he doesn't forget, keeps every subject on pace without ever skipping a topic, and gets him building real projects from week 1.

Subjects (called **tracks** below): **Python, C++, Algorithms & data structures, Math for AI and robotics, AI (data science → ML → deep learning), Robotics (electronics → Arduino → ROS 2), Projects, Engineering tools (Linux, Git).**

---

## 1. Who the learner is

- **Mustafa**, mentor at AQL (Applied Quality Learning) Academy. Bachelor's and master's in computer engineering. Knows programming basics (variables, arrays, loops) but feels his programming and algorithms foundation is weak and wants it rock-solid.
- **Goal:** expert-level AI engineer (broad: data science, ML, DL, plus core AI ideas like search, planning, probabilistic reasoning, RL) **and** robotics engineer. He wants to reach real project-building as fast as possible.
- **He teaches robotics to first-year students** at AQL, in a course he is creating: **electronics basics now → Arduino from January 2027 → ROS 2 from September 2027.** He doesn't know ROS yet and learns each part **3–4 weeks before he teaches it**. The robotics track doubles as his teaching prep.
- **Intensive pace: about 46 study hours a week.** His job is flexible: at most **2 h/day of work tasks** (course planning, office errands) and **2 h/day with students**, placed anywhere in the day.
- **Sleep is protected: 22:30–05:30, 7 hours.** He asked to push hard but not to sacrifice night sleep. Never schedule anything into that window, and never let the app or the AI suggest cutting it. If he proposes less sleep, the AI pushes back briefly with the reason (sleep is when the day's learning is consolidated).
- **Tone he wants:** natural and human, like a capable colleague explaining something. Not childish, not stiff or over-structured. No hype, no motivational slogans (this matches Yaver's existing tone rules).
- **Time zone:** Asia/Atyrau (UTC+5). Use the app's local-date helpers (`today()`, `addDays()`, `parseDay()` in `js/util.js`) for every date calculation.
- **Calendar:** Week 0 (setup) = **Thu 2026-10-15 → Sun 2026-10-18**. **Week 1 starts Monday 2026-10-19.** Week *n* starts on 2026-10-19 + 7·(n−1) days.

There is already a matching plan document (a "Roadmap" tab and a "Weekly plan" tab) that this course turns into a working app feature. Everything you need from it is reproduced below.

---

## 2. Read this repo first

Read these before writing anything, and follow their conventions exactly:

| File | Why |
| --- | --- |
| `docs/ARCHITECTURE.md` | How Yaver works: PWA, IndexedDB, no server, agent loop, offline. |
| `js/app.js` | Screen routing (`go(name)`, `TABS`), redraw on DB change. |
| `js/db.js` | Stores, `DB_VERSION`, `put/get/all/remove`, settings, backup export/import. |
| `js/data.js` | Shared business logic used by both screens and AI tools (`logStudy`, `studySummary`, `importPlan`, `planStatus`, `PRACTICE`, `addPractice`). |
| `js/views/study.js` | The current Study tab: focus timer that stores its start time, roadmap card, practice tiles, "Quiz me", "Plan my week". |
| `js/util.js` | `html`/`raw` templating, `md()` Markdown, `sheet()`, `toast()`, `haptic()`, date helpers. |
| `js/ai/tools.js` | The `TOOLS` list (schema + `run`). Gemini reuses it. |
| `js/ai/claude.js`, `js/ai/gemini.js`, `js/ai/provider.js` | `STATIC_SYSTEM`, the agent loops, model switching. |
| `js/ai/assistant.js` | `openAssistant(prompt)`: the chat screen. |
| `js/ics.js` | `openInCalendar(events)`: hands iOS an `.ics` with alarms. |
| `js/reminders.js` | Plain "what needs attention today" facts shown on Home and given to the AI. |
| `sw.js` | Offline cache: `VERSION` and the `FILES` list. |
| `tests/smoke.mjs` | Playwright smoke test with simulated Claude and Gemini APIs. |
| `data/ml-roadmap.json` | The old 52-week, 15 h/week plan. The new course supersedes it (see §10). |

**House rules (non-negotiable):**
- Plain JavaScript ES modules. **No framework, no build step, no new runtime dependencies.** Safari runs the files as written.
- Screens and AI tools share the same functions in `js/data.js` (or a new `js/course.js` that both import). Never duplicate logic between a view and a tool.
- Every DB write goes through `db.put`/`db.remove` so the change event redraws the screen.
- Everything works **offline** (only the AI needs a connection). Add every new file to `FILES` in `sw.js` and **bump `VERSION`**.
- **Phone and desktop from one codebase.** On the phone: one column, big tap targets (≥ 44 px), safe areas. On a laptop: the desktop layout, mouse and keyboard support in §10b. Both use the existing dark theme, the CSS variables in `css/app.css` and the `~/yaver › section` header style. No separate desktop pages and no duplicated view code: responsive CSS plus small JS checks where behaviour differs.
- Don't break any existing feature or test.

---

## 3. The learning method (why the course is shaped this way)

Each principle below is well supported by research, and each maps to something concrete in the app. Build all of them.

| Principle | Evidence | What the app does |
| --- | --- | --- |
| **Retrieval practice**: recalling beats rereading | Roediger & Karpicke 2006; Dunlosky et al. 2013 rate practice testing "high utility" | Every lesson opens with a recall warm-up and ends with an exit ticket. Sunday is a test, not a recap. |
| **Spacing**: revisit after growing gaps | Cepeda et al. 2006 (meta-analysis) | Built-in review cards with intervals 1 → 3 → 7 → 14 → 30 → 60 days. Each track returns on non-consecutive days. |
| **Interleaving**: mix problem types | Rohrer & Taylor 2007 | Saturday "mixed practice" block and the Sunday test shuffle topics across all tracks. |
| **Pretesting / generation**: try before being told | Richland, Kornell & Kao 2009; Bjork's "desirable difficulties" | Each lesson has a short "predict or try first" step before the explanation. |
| **Worked examples, then fading** | Sweller (cognitive load); Renkl | Learn step shows a fully worked example; practice tasks go from guided to unguided. |
| **Self-explanation and teaching back** | Chi et al. 1994; Nestojko et al. 2014 (expecting to teach) | Exit ticket includes "explain this to a first-year student in 3 sentences". Mustafa really does teach, so robotics lessons end in teaching notes. |
| **Deliberate practice at the edge** | Ericsson et al. 1993 | Practice tasks are hard enough to struggle; hint ladder unlocks after 30 min stuck. About 3 hours of true deep work per weekday, the rest lighter. |
| **Mastery learning** | Bloom 1968/1984 | A lesson counts as mastered at ≥ 80% on its exit ticket; below that it's flagged and its cards come back tomorrow. |
| **Implementation intentions** | Gollwitzer 1999 | Every block has a fixed time; the evening review confirms "at 05:50 I'll do *X*", and blocks can be exported to the iPhone Calendar with alarms. |
| **Consolidation / deload** | Training periodization | Every 6th week runs at ~60% volume: review, retests, finishing projects. |
| **Sleep protects learning** | Walker; Van Dongen et al. 2003 | Sleep window is fixed; the app never schedules into it. |

---

## 4. The daily structure

A **slot** is a fixed time block. Each slot holds **exactly one lesson from one track**. **Every lesson is at least 60 minutes.** The 30-minute evening Review is not a lesson; it's the review queue plus planning.

### Weekdays (Mon–Fri): about 7 h of study

| Slot id | Time | Minutes | Holds |
| --- | --- | --- | --- |
| — | 05:30–05:50 | — | Wake, water, 15-min walk, no phone (shown, not a lesson) |
| `deep1` | 05:50–07:20 | 90 | Hardest new material |
| — | 07:20–07:35 | — | Break |
| `deep2` | 07:35–09:05 | 90 | Practice at the edge |
| `work` | 10:00–12:00 | — | Work tasks (2 h). Movable. Not part of the course. |
| `students` | 13:00–15:00 | — | Students (2 h). Movable. Not part of the course. |
| `build` | 15:20–16:50 | 90 | Weekly project |
| — | 16:50–17:30 | — | Exercise |
| `prep` | 17:30–18:30 | 60 | Robotics, 3–4 weeks ahead of the students |
| `light` | 19:30–20:30 | 60 | Reading and lectures (lower effort) |
| `review` | 20:30–21:00 | 30 | Review cards, log the day, plan tomorrow |
| — | 22:00–22:30 | — | Screens off |
| — | 22:30–05:30 | — | **Sleep (protected)** |

### Saturday: about 8.75 h

| Slot id | Time | Minutes | Holds |
| --- | --- | --- | --- |
| `deep1` | 05:50–07:20 | 90 | AI track main lesson |
| `deep2` | 07:35–09:05 | 90 | **Mixed practice** (interleaved, all tracks) |
| `build` | 10:00–12:00 | 120 | Weekly project |
| `lab` | 13:00–15:00 | 120 | Robotics on real hardware; build next week's student circuits |
| `light` | 15:20–16:50 | 90 | Reading |
| `review` | 20:30–20:45 | 15 | Review cards only |

### Sunday: about 3 h, then free

| Slot id | Time | Minutes | Holds |
| --- | --- | --- | --- |
| `test` | 05:50–07:20 | 90 | **Weekly retrieval test** + review cards |
| `ship` | 07:35–09:05 | 90 | **Ship & weekly review**: push the project, check pace, plan next week |
| `plan` | 20:30–20:40 | 10 | Confirm Monday's first block |

Slot times are **editable** in Course settings (the work and student blocks especially), but the app must refuse any template that puts a slot inside the sleep window or leaves less than 7 hours of sleep, with a one-line reason.

### Which track goes in which slot (rotation)

The rotation is defined **per phase** in `course.json` (see §7) and drives everything. Each active track gets **at least two sessions a week**, and no track runs on two consecutive days in `deep1` (that's the spacing).

**Phase A: Weeks 1–7 (Oct 19 – Dec 6, 2026)**

| Slot | Mon | Tue | Wed | Thu | Fri | Sat |
| --- | --- | --- | --- | --- | --- | --- |
| `deep1` | python | math | python | math | python | ai |
| `deep2` | algo | math | algo | math | algo | mixed |
| `build` | build | build | build | build | build | build (120) |
| `prep` / `lab` | robo | robo | robo | robo | robo | robo `lab` (120) |
| `light` | tools | ai | tools | ai | buffer | ai (90) |

**Phase B: Weeks 8–15 (Dec 7, 2026 – Jan 31, 2027)**

| Slot | Mon | Tue | Wed | Thu | Fri | Sat |
| --- | --- | --- | --- | --- | --- | --- |
| `deep1` | cpp | math | cpp | math | cpp | ai |
| `deep2` | algo | math | algo | math | algo | mixed |
| `build` | build | build | build | build | build | build (120) |
| `prep` / `lab` | robo | robo | robo | robo | robo | robo `lab` (120) |
| `light` | ai (SQL) | ai (stats) | ai (SQL) | ai (stats) | buffer | python (90) |

Python doesn't stop in Phase B: algorithm practice is in Python, the projects are Python, and Saturday's light block covers intermediate Python.

### Lanes (how slots pick lessons)

A track can appear in slots of different lengths (the `ai` track is a 90-min Saturday lesson *and* 60-min evening reading). So each track is split into **lanes**, and every lesson belongs to exactly one lane. All lessons in a lane have the lane's length. The rotation maps each slot and weekday to a lane, and a slot always shows **that lane's** next unfinished lesson.

| Lane | Track | Slot(s) | Minutes | Phases |
| --- | --- | --- | --- | --- |
| `python` | python | `deep1` Mon/Wed/Fri | 90 | A |
| `python-inter` | python | `light` Sat | 90 | B |
| `cpp` | cpp | `deep1` Mon/Wed/Fri | 90 | B |
| `algo` | algo | `deep2` Mon/Wed/Fri | 90 | A, B |
| `math-learn` | math | `deep1` Tue/Thu | 90 | A, B |
| `math-practice` | math | `deep2` Tue/Thu | 90 | A, B |
| `ai-main` | ai | `deep1` Sat | 90 | A, B |
| `ai-read` | ai | `light` Tue/Thu (A) | 60 | A |
| `ai-read-long` | ai | `light` Sat | 90 | A |
| `ai-sql` | ai | `light` Mon/Wed | 60 | B |
| `ai-stats` | ai | `light` Tue/Thu | 60 | B |
| `tools` | tools | `light` Mon/Wed | 60 | A |
| `robo-prep` | robo | `prep` Mon–Fri | 60 | A, B |
| `robo-lab` | robo | `lab` Sat | 120 | A, B |
| `build` | build | `build` Mon–Fri | 90 | A, B |
| `build-long` | build | `build` Sat | 120 | A, B |

Define the lanes for later phases in `course.json` the same way. Pace (§8.4) is computed per lane and shown per track.

**Phases C–F (Week 16 onward):** define rotations in `course.json` from the outline in §6.3 using the same rules. Suggested default: `deep1` Mon/Wed/Fri = ai, Tue/Thu = math (AIMA, robotics math); `deep2` Mon/Wed/Fri = algo until week 24, then ai practice; Tue/Thu = math; `prep` = robo; `build` = build; `light` Mon/Wed = robo reading (ROS 2 docs), Tue = cpp (modern C++ for ROS), Thu = ai breadth reading, Fri = buffer; Sat as before.

### Special slots

- **`mixed`** (Sat `deep2`): generated, not bundled. Pick 1–2 practice tasks from each track's lessons in the last 14 days plus 5 review cards, shuffle them so topics alternate, 90 minutes total. Deterministic for a given date (seed by date).
- **`buffer`** (Fri `light`): holds the next lesson of the track that is **most behind** (§8.4). If no track is behind, it holds the next lesson of the track with the nearest teaching deadline, else "free / read ahead".
- **`test`** and **`ship`** (Sunday): see §8.6.
- **Consolidation weeks:** weeks **6, 11**, then every 6th week (**17, 23, 29, 35, 41, 47, 53, 59**). Week 11 falls over New Year on purpose. See §8.7.

---

## 5. The tracks

| id | Name | Color hint | Runs | Main resources |
| --- | --- | --- | --- | --- |
| `python` | Python | blue | Core weeks 1–7; intermediate Sat light weeks 8–15; used daily after that in algo and projects | Harvard **CS50P** (lectures 0–9 + final project); Exercism Python track; Python docs (tutorial and library reference); *Fluent Python* (Ramalho) as reference |
| `cpp` | C++ | purple | Core weeks 8–15; then weekly for ROS 2 (`rclcpp`) and Arduino | **learncpp.com**; *A Tour of C++* (Stroustrup) |
| `algo` | Algorithms & data structures | amber | Weeks 1–24 (then maintained through `mixed`) | *Grokking Algorithms*, 2nd ed. (Bhargava) in weeks 1–7; **NeetCode 150** by pattern in weeks 8–24; *The Algorithm Design Manual* (Skiena) as reference |
| `math` | Math for AI & robotics | teal | Whole course | 3Blue1Brown *Essence of Linear Algebra* and *Essence of Calculus*; *Mathematics for Machine Learning* (Deisenroth, Faisal, Ong, free); Khan Academy statistics & probability; later *Modern Robotics* (Lynch & Park, free), *Probabilistic Robotics* (Thrun, Burgard, Fox), Brian Douglas's control videos |
| `ai` | AI: data science, ML, DL | green | Whole course | *Python for Data Analysis*, 3rd ed. (McKinney, free online); *Practical Statistics for Data Scientists*, 2nd ed.; SQLBolt; then ISLP (free), Andrew Ng's *Machine Learning Specialization*, *Hands-On Machine Learning* (Géron); then Karpathy's *Neural Networks: Zero to Hero*, fast.ai *Practical Deep Learning*, *Dive into Deep Learning* (d2l.ai); AI breadth from *AIMA* (Russell & Norvig) and *Reinforcement Learning: An Introduction* (Sutton & Barto, free); ML engineering from *Designing Machine Learning Systems* (Huyen) |
| `robo` | Robotics | orange | Whole course; doubles as teaching prep | *Make: Electronics* (Platt), *Practical Electronics for Inventors* (reference); Wokwi or Tinkercad Circuits simulators; *Exploring Arduino* (Blum); Arduino docs; ROS 2 official docs and tutorials; *A Concise Introduction to Robot Programming with ROS2* (Martín Rico); Articulated Robotics (YouTube); Hugging Face LeRobot |
| `build` | Projects | red | Whole course | The weekly project list in §6 |
| `tools` | Engineering tools | grey | Weeks 1–7 (Docker etc. later inside `ai`) | *The Linux Command Line* (Shotts, free); *Pro Git* (free) |

**ROS 2 version:** default to **Lyrical Luth** (the newest LTS, paired with Ubuntu 26.04). Use **Jazzy** (Ubuntu 24.04, supported to May 2029) only where a key tutorial or the robot's hardware doesn't support Lyrical yet. Pin one version for the whole teaching course, and say so in the first ROS lesson.

**Resources rules:** verify every URL you include (fetch it). If you can't verify a deep link, link to the resource's home page instead. Never invent URLs, chapter numbers or chapter titles: when unsure, refer to the topic by name ("the chapter on hash tables").

---

## 6. Syllabus

Each row lists, **in order**, the units that track covers that week; where a track has several lanes, the table says which lane each unit belongs to. One unit = one lesson = one session, so the number of lessons per lane per week **equals** that lane's scheduled sessions. The validator in §11 enforces this.

### 6.0 Week 0: setup (Thu Oct 15 – Sun Oct 18, 2026)

Four one-off lessons (≥ 60 min each, lane `setup`, outside the rotation), shown on those dates in place of the normal slots:

| Day | Lesson |
| --- | --- |
| Thu Oct 15 | **Set up your machine.** Ubuntu (dual boot) or WSL2, VS Code, Python 3, Git; GitHub account; a `learning-log` repo; Anki installed (optional; Yaver's built-in review cards replace it for course material). |
| Fri Oct 16 | **Diagnostic test**, no AI, no Googling (questions below). Record which problems stopped you. |
| Sat Oct 17 | **Plan the first project and the first month of teaching.** One-page spec for a student progress tracker (what the AQL portal can export, what report would help; anonymized data only). List the electronics lessons for the next 4 weeks and check parts. |
| Sun Oct 18 | **Lock in Week 1.** Export Week 1's blocks to the iPhone Calendar (§8.8). Bed by 22:30. Tip: if he normally sleeps later, move bedtime 20–30 min earlier per night. |

**Diagnostic test** (bundle with model answers and a self-grading rubric):
1. Return the second-largest number in a list without sorting it.
2. Check whether a bracket string like `{[()]}` is balanced.
3. Write a recursive function that returns all subsets of a list.
4. Explain why a loop inside a loop over the same list is O(n²), then make "find two numbers that sum to X" faster (hash set, O(n)).
5. Write a `BankAccount` class with deposit and withdraw, plus tests that stop the balance going negative.
6. A 9 V supply drives a red LED (2 V, 20 mA). Which resistor, and why? (Answer: (9 − 2) / 0.02 = 350 Ω → choose the next standard value up, 390 Ω, ≈ 18 mA; resistor dissipates ≈ 0.13 W, so ¼ W is fine.)
7. Blink an LED and read a button at the same time without `delay()` (answer: `millis()`-based timing).

Reading the score: if 1–3 and 6 come easily, he can move faster; stuck on 2, 3 or 7 is normal and shows where to begin. Store the score; the same test is retaken in Week 6 and compared.

### 6.1 Phase A: Weeks 1–7 (Oct 19 – Dec 6, 2026)

Sessions per week: python 3, algo 3, math 4 (`math-learn` 2 + `math-practice` 2), ai 4 (`ai-read` 2 + `ai-main` 1 + `ai-read-long` 1), tools 2, robo 6 (`robo-prep` 5 + `robo-lab` 1), build 6 (`build` 5 + `build-long` 1).

**Python (CS50P)**
| Week | Units |
| --- | --- |
| 1 | CS50P 0: Functions, Variables · CS50P 1: Conditionals · CS50P 2: Loops, plus using the VS Code debugger (breakpoints, step, watch) |
| 2 | CS50P 3: Exceptions · CS50P 4: Libraries (modules, pip, virtual environments) · Lists, dicts, sets, tuples and comprehensions in depth |
| 3 | CS50P 5: Unit Tests (pytest) · CS50P 6: File I/O (CSV, JSON, pathlib) · Strings and formatting in depth |
| 4 | CS50P 7: Regular Expressions · CS50P 8: OOP part 1 (classes, methods, properties) · OOP part 2 (inheritance, dunder methods, dataclasses) |
| 5 | Recursion and the call stack · Iterators and generators · CS50P 9: Et Cetera (type hints, `*args/**kwargs`, `map/filter`, `lambda`) |
| 6 | Consolidation (§8.7) |
| 7 | CS50P final project: design · build · test and publish |

**Algorithms (weeks 1–7: *Grokking Algorithms* topics, implemented in Python, plus Exercism problems)**
| Week | Units |
| --- | --- |
| 1 | Binary search and Big-O (implement and time it vs linear search) · Arrays vs linked lists; selection sort · Big-O drills: classify 15 snippets |
| 2 | Implement a singly linked list class with tests · Recursion and the call stack · Recursion drills (sum, count, max, recursive binary search) |
| 3 | Divide and conquer; quicksort · Merge sort (implement) · Comparing sorts: Big-O, stability, in-place |
| 4 | Hash tables (implement a hash map with chaining) · Hashing problems (two-sum, anagrams, frequency counts) · Stacks and queues (implement; balanced brackets) |
| 5 | Graphs as adjacency lists; breadth-first search · Depth-first search; flood fill · Backtracking intro: subsets and permutations |
| 6 | Consolidation |
| 7 | Trees; binary search tree insert/search/traversals · BST implementation with tests · Dijkstra's algorithm on a small graph (seed for a later pathfinding visualizer) |

**Math (deep1 Tue/Thu = learn; deep2 Tue/Thu = practice in NumPy)**
| Week | Learn (Tue, Thu) | Practice in NumPy (Tue, Thu) |
| --- | --- | --- |
| 1 | EoLA 1–2: vectors; linear combinations, span, basis · EoLA 3: linear transformations and matrices | Vectors as arrays and plots · Matrix–vector product by hand vs `@` |
| 2 | EoLA 4: matrix multiplication as composition · EoLA 5: 3D transformations | Compose rotations · Matmul with loops vs `@`, timed |
| 3 | EoLA 6: the determinant · EoLA 7: inverse, column space, rank, null space | `det`, `inv`, `solve`, rank on examples · Solve a small linear system 3 ways |
| 4 | EoLA 8: nonsquare matrices · EoLA 9: dot products and duality | Projections · Cosine similarity on text-count vectors |
| 5 | EoLA 10–11: cross products · EoLA 13: change of basis | Cross products in 3D · Coordinate frames: rotate a 2D point between frames (the robotics link) |
| 6 | Consolidation | Consolidation |
| 7 | EoLA 14–15: eigenvectors and eigenvalues · *Mathematics for Machine Learning* ch. 2 (linear algebra), with the sections that tie it together | Power iteration from scratch · Ch. 2 exercises in NumPy |

**AI: data science.** Unmarked units → `ai-read` (Tue, Thu), **Sat:** → `ai-main`, *Sat light:* → `ai-read-long`.
| Week | Units |
| --- | --- |
| 1 | McKinney ch. 2: Python basics and Jupyter · ch. 3: built-in data structures · **Sat:** ch. 4: NumPy arrays and indexing · Sat light: ch. 4 continued (universal functions) |
| 2 | Array-oriented programming · Appendix A: advanced NumPy (broadcasting) · **Sat:** vectorization: loop vs vectorized, timed · Sat light: random numbers and simulation with NumPy |
| 3 | ch. 5: pandas Series and DataFrame · indexing and selection · **Sat:** pandas on the tracker data · Sat light: arithmetic and alignment in pandas |
| 4 | ch. 6: loading data (CSV, JSON, Excel) · ch. 7: cleaning (missing values, duplicates) · **Sat:** clean a messy real dataset · Sat light: string and categorical cleaning |
| 5 | ch. 8: joins and reshaping · ch. 9: plotting · **Sat:** charts of the tracker data · Sat light: what makes a chart honest and readable |
| 6 | Consolidation |
| 7 | ch. 10: group-by and aggregation · group-by practice · **Sat:** analysis plan for the first data project · Sat light: writing up findings |

**Tools (Mon/Wed light)**
| Week | Units |
| --- | --- |
| 1 | The shell, navigation, exploring the system · Manipulating files and directories, wildcards |
| 2 | Permissions and users · Redirection, pipes, `grep`, `find` |
| 3 | Git basics: init, add, commit, log, diff, `.gitignore` · Branches and merging |
| 4 | Bash scripting: variables, if, loops · Script that runs the tracker and saves a dated report |
| 5 | `ssh` and keys; processes (`ps`, `top`, `kill`) · Package managers (`apt`, `pip`, `venv`), environment variables, `PATH` |
| 6 | Consolidation |
| 7 | GitHub: remotes, pull requests, issues · Writing a good README; repo hygiene |

**Robotics: electronics (Mon–Fri prep 60 + Sat lab 120)**
Each prep lesson: learn the concept, simulate it (Wokwi or Tinkercad Circuits), measure it on a real board, write the student lesson notes. Saturday lab builds the week's circuits on real kits and prepares student handouts.
| Week | Units |
| --- | --- |
| 1 | Charge, voltage, current, resistance · Ohm's law with worked calculations · Using a multimeter (V, I, R; safe habits) · Power and resistor wattage · Write the week's student lesson · **Lab:** build and measure every circuit |
| 2 | Series circuits · Parallel circuits · Voltage dividers · Kirchhoff's laws (KVL, KCL) · Breadboard layout and common mistakes · **Lab** |
| 3 | Diodes · LEDs and current-limiting resistors · Resistor colour codes and standard values (E12) · Reading a datasheet · Student lesson write-up · **Lab** |
| 4 | Capacitors · RC time constant (measure charging) · Decoupling capacitors · Debugging a circuit methodically · Student lesson write-up · **Lab** |
| 5 | Transistors as switches (NPN; base resistor calculation) · Driving a load; flyback diodes · Relays · Power supplies and batteries (safety) · Student lesson write-up · **Lab** |
| 6 | Consolidation: simulate every circuit so far |
| 7 | Arduino board anatomy · Breadboard + digital output (blink, in simulator) · Digital input (buttons, pull-ups) · Uploading to a real board; common errors · Student lesson write-up · **Lab** |

**Projects (build Mon–Fri 90 + Sat 120; shipped Sunday)**
Each day's build lesson has its own concrete goal for that day; the week's project brief is shared.
| Week | Project |
| --- | --- |
| 1 | **Tracker v1:** reads an anonymized portal CSV, prints each student's completion |
| 2 | **Tracker v2:** statistics per student and per topic |
| 3 | **Tracker v3:** pytest tests for every function; JSON output |
| 4 | **Tracker v4:** rebuilt from classes; flags students who are falling behind |
| 5 | **Recursion set** (subsets, permutations, flood fill) + charts of tracker data |
| 6 | Clean READMEs on everything; refactor (consolidation) |
| 7 | **First data project:** full analysis of student progress (cleaning, charts, findings) published on GitHub |

**End of Phase A check:** solves the Week 0 Python problems in under 30 minutes; can explain matrix multiplication as "one transformation after another"; can explain Ohm's law and size an LED resistor to a student.

### 6.2 Phase B: Weeks 8–15 (Dec 7, 2026 – Jan 31, 2027)

Sessions per week: cpp 3, algo 3, math 4 (`math-learn` 2 + `math-practice` 2), ai 5 (`ai-main` 1 + `ai-sql` 2 + `ai-stats` 2), python 1 (`python-inter`), robo 6, build 6.

**C++ (learncpp.com)**
| Week | Units |
| --- | --- |
| 8 | Setup, compiling and running; variables, types, functions, input/output · Multiple files and header files · Debugging C++ (VS Code debugger or gdb) |
| 9 | Control flow · References and `const` · `std::string` and `std::string_view` |
| 10 | Classes and constructors · Member functions, encapsulation, access control · Operator overloading basics |
| 11 | Consolidation (New Year) |
| 12 | `std::vector` and `std::array` · `std::map`, `std::unordered_map`, `std::set` · Iterators and `<algorithm>` (sort, find, count_if) |
| 13 | Pointers and memory (stack vs heap) · Dynamic allocation and RAII · Smart pointers (`unique_ptr`, `shared_ptr`) |
| 14 | Writing your own Arduino library (class in `.h/.cpp`, library layout) · Templates basics · CMake basics |
| 15 | Review · Small command-line project in C++: build · test and publish |

**Algorithms (NeetCode 150 by pattern, solved in Python; 3–5 problems per session; name and link problems, never copy their statements)**
| Week | Units |
| --- | --- |
| 8 | Arrays & hashing ×3 |
| 9 | Two pointers ×3 |
| 10 | Sliding window ×2 · Stack ×1 |
| 11 | Consolidation |
| 12 | Binary search ×3 |
| 13 | Linked lists: implement in C++ with tests · NeetCode linked-list problems ×2 |
| 14 | Trees: traversals (BFS, DFS) · depth, balance, LCA · tree problems |
| 15 | Heaps and priority queues: implement a binary heap · heap problems ×2 |

**Math**
| Week | Learn (Tue, Thu) | Practice (Tue, Thu) |
| --- | --- | --- |
| 8 | EoC 1–2: derivatives, the intuition · EoC 3: derivative formulas through geometry | Finite differences in NumPy · Derivatives by hand |
| 9 | EoC 4: chain rule and product rule · EoC 5–6: e; implicit differentiation | Chain rule drills · Numerical gradient check |
| 10 | Partial derivatives and gradients (MML ch. 5 opening sections) · Gradient descent by hand | Gradient descent in NumPy · Fit a line with gradient descent |
| 11 | Consolidation | Consolidation |
| 12 | Probability rules · Conditional probability (Khan Academy) | Probability problems · Simulate in NumPy |
| 13 | Bayes' rule · Random variables | Bayes problems · Simulations |
| 14 | Expectation and variance · The normal distribution | Simulate distributions · Central limit theorem demo |
| 15 | MML ch. 6: probability and distributions, part 1 · part 2 | Ch. 6 exercises ×2 |

**AI: statistics and SQL (Sat deep1; light Mon/Wed SQL, Tue/Thu statistics reading)**
| Week | Sat deep1 | Light Mon/Wed (SQL) | Light Tue/Thu (*Practical Statistics*) |
| --- | --- | --- | --- |
| 8 | Descriptive statistics | SQLBolt 1–3 · SQLBolt 4–5 | Ch. 1: exploratory data analysis ×2 |
| 9 | Distributions | SQLBolt 6–7 (joins) · SQLBolt 8–9 | Ch. 2: data and sampling distributions ×2 |
| 10 | SQL joins and aggregates on the tracker data (`sqlite3` from Python) | SQLBolt 10–12 (aggregates) · SQLBolt 13–18 | Ch. 2 continued · bootstrap in NumPy |
| 11 | Consolidation | | |
| 12 | Hypothesis tests, A/B testing | SQL on real data · SQL practice set | Ch. 3: experiments and significance testing ×2 |
| 13 | Correlation; regression intuition | Window functions basics · SQL review | Ch. 4: regression and prediction ×2 |
| 14 | Exploratory analysis of a Kaggle dataset | Kaggle Learn: pandas review · data visualization | Ch. 4 continued · Ch. 5 opening |
| 15 | Data science mini-capstone: analysis + short report | Write the report · Publish | Review · Review |

**Python intermediate (Sat light, 90 min)**: Wk 8 argparse and building CLIs · 9 logging · 10 packaging with `pyproject.toml` · 12 type hints and mypy · 13 context managers and decorators · 14 `itertools` and `functools` · 15 profiling and performance.

**Robotics: Arduino (prep + lab; he teaches this from January)**
| Week | Units |
| --- | --- |
| 8 | Digital vs analog signals; `digitalRead`/`digitalWrite` · Buttons and debouncing · Potentiometers and `analogRead` · Serial monitor; debugging with prints · Student lesson write-up · **Lab** |
| 9 | PWM and `analogWrite` · LED fading; RGB LEDs · Servos · Powering servos safely (separate supply, common ground) · Student lesson write-up · **Lab** |
| 10 | Ultrasonic distance sensor · IR sensors (line and obstacle) · Serial plotter; smoothing noisy readings · Combining sensors with a simple state machine · Student lesson write-up · **Lab** |
| 11 | Consolidation |
| 12 | DC motors and why they need a driver · Motor drivers (L298N or TB6612FNG): direction and speed · `millis()` timing without `delay()` · Obstacle-avoiding car logic · Student lesson write-up · **Lab** |
| 13 | Interrupts and `volatile` · Wheel encoders; counting ticks · Measuring speed from encoders · Driving straight with encoders · Student lesson write-up · **Lab** |
| 14 | PID control, the intuition (Brian Douglas, *Understanding PID Control*) · P, I and D on a real motor · Line sensor arrays · Tuning a line follower · Student lesson write-up · **Lab** |
| 15 | Arduino ↔ Python over serial (`pyserial`) · Message formats (CSV lines, simple packets) · Live plotting in Python · Sending commands from Python to the Arduino · Student lesson write-up · **Lab** |

**Projects**
| Week | Project |
| --- | --- |
| 8 | Publish the data project write-up · Button-controlled LEDs |
| 9 | Servo demo · SQL practice set |
| 10 | Gradient descent from scratch · Distance sensor readout |
| 11 | Clean READMEs (consolidation) |
| 12 | **Obstacle-avoiding car** (simulator, then real) |
| 13 | **Linked list and stack library in C++** with tests |
| 14 | **PID line follower** |
| 15 | **Live sensor dashboard:** Arduino data plotted in Python |

### 6.3 Weeks 16–63: outline (bundle as week outlines, not full lessons)

For each week, store a theme and per-track units in `course.json`. Day-level lessons for these weeks are generated later (§9.4), one week at a time.

| Block | Weeks (approx. dates) | Content |
| --- | --- | --- |
| **C** | 16–24 (Feb 1 – Apr 4, 2027) | **algo:** finish NeetCode 150 (backtracking, tries, graphs, advanced graphs, 1-D and 2-D dynamic programming, greedy, intervals, math & bit manipulation). **math/ai breadth:** AIMA search and planning (uninformed and informed search, A*, local search, constraint satisfaction). **ai:** classical ML: ISLP chapters on statistical learning, linear regression, classification, resampling, regularization, tree-based methods; Ng's specialization courses 1–2; Géron part I; first Kaggle competition. **robo:** teach Arduino; learn ROS 2 basics in simulation (install, nodes, topics, services, actions, launch files, parameters). **cpp:** `rclcpp` nodes. **build:** pathfinding visualizer (BFS, Dijkstra, A*); Kaggle entry; end-to-end prediction project. |
| **D** | 25–33 (Apr 5 – Jun 6) | **math:** *Modern Robotics* ch. 2–4 (configuration space, rigid-body motions, forward kinematics). **robo:** ROS 2 core in simulation: TF2, URDF, RViz, Gazebo. **ai:** deep learning: Karpathy (micrograd, makemore, build GPT), fast.ai, PyTorch, d2l.ai. **build:** micrograd; a small GPT; rebuild the face recognition project understanding embeddings and evaluation. |
| **E** | 34–46 (Jun 7 – Sep 5) | **math:** *Probabilistic Robotics*: Bayes filters, Kalman filter, EKF, particle filter; implement a Kalman filter. **robo:** build the course robot (Arduino-class motor/encoder board + Raspberry Pi running ROS 2 + camera + low-cost lidar); Nav2; SLAM Toolbox; micro-ROS; **write the ROS 2 course** (every lab run end-to-end before September). **ai:** ML engineering (Huyen; FastAPI; Docker; experiment tracking); computer vision on the robot (OpenCV, a detector as a ROS 2 node); transformer basics. |
| **F** | 47–63 (Sep 6, 2027 – Jan 2, 2028) | **robo:** teach ROS 2; capstone robot. **math:** deeper control (PID tuning, state-space basics). **ai:** reinforcement learning (Sutton & Barto ch. 1–6, OpenAI Spinning Up); robot learning with LeRobot; system design basics. **build capstone:** the course robot drives itself with Nav2, maps a room, and recognises people or objects with a model he trained and deployed himself. |

---

## 7. Content files and lesson schema

### 7.1 Files

```
data/course/
  course.json            # meta: tracks, slots, phases + rotations, consolidation weeks, week list (themes, outlines, file refs), diagnostic
  weeks/week-00.json     # day-level lessons, one file per week (00–15 bundled now)
  weeks/week-01.json
  …
  weeks/week-15.json
js/course.js             # all course logic (shared by views and AI tools)
js/views/course.js       # course overview screen
js/views/lesson.js       # lesson runner screen
tests/validate-course.mjs
tests/run-lesson-code.mjs
```

Load `course.json` at startup; load week files on demand (current week and next). All of them go in `sw.js` `FILES` so they work offline.

### 7.2 Lesson object

```json
{
  "id": "py-w01-1",
  "track": "python",
  "lane": "python",
  "week": 1,
  "seq": 1,
  "kind": "deep",
  "minutes": 90,
  "title": "Functions and variables",
  "objectives": ["Write functions with parameters and return values", "Predict what a short program prints", "Explain the difference between printing and returning"],
  "prereqs": [],
  "resources": [
    { "title": "CS50P Lecture 0: Functions, Variables", "url": "https://cs50.harvard.edu/python/", "part": "lecture video + notes", "type": "video" }
  ],
  "steps": [
    { "kind": "warmup",   "minutes": 10, "title": "Recall", "questions": [{ "q": "…", "a": "…" }] },
    { "kind": "pretest",  "minutes": 5,  "title": "Predict first", "body": "Markdown: before watching, predict what this prints…" },
    { "kind": "learn",    "minutes": 35, "title": "Learn", "body": "Markdown: the key ideas in his own-level language, then a worked example with runnable code." },
    { "kind": "practice", "minutes": 30, "title": "Practice without notes", "tasks": [
        { "prompt": "Markdown task", "hints": ["nudge", "hint", "bigger hint"], "check": "How to know it's right: test cases / expected output", "solution": "Markdown, hidden until he asks" }
    ] },
    { "kind": "exit",     "minutes": 10, "title": "Exit ticket", "questions": [{ "q": "…", "a": "…" }], "teachBack": "Explain to a first-year student, in three sentences, why return beats print inside a function." }
  ],
  "cards": [{ "front": "What does a function return if it has no return statement?", "back": "None" }],
  "deliverable": "A file functions.py with the three practice functions, committed to learning-log.",
  "teachBy": null,
  "safety": null
}
```

Field rules:
- `id`: `<track>-w<NN>-<k>` (e.g. `algo-w05-2`, `robo-w03-lab`). Unique across the course.
- `lane`: one of the lanes in §4; `minutes` must equal the lane's minutes.
- `seq`: position within the lane across the whole course (1, 2, 3, …). No gaps.
- `kind` and its step template (minutes must sum exactly to `minutes`; `minutes` ≥ 60):

| kind | minutes | steps (minutes) |
| --- | --- | --- |
| `deep` (new material) | 90 | warmup 10 · pretest 5 · learn 35 · practice 30 · exit 10 |
| `practice` (deep2) | 90 | warmup 5 · worked example 10 (`learn`) · practice 60 (timed problems; hints unlock after 30 min stuck) · `reflect` 10 (compare with solutions, name the pattern) · exit 5 |
| `build` | 90 / 120 | `plan` 10 · `build` 65 / 95 · `test` 10 (run tests, commit) · `log` 5 |
| `prep` (robotics) | 60 | `learn` 15 · `simulate` 20 · `measure` 15 (real board) · `teachnotes` 10 |
| `lab` (robotics) | 120 | `build` 60 (real circuits) · `measure` 25 · `handout` 25 (student handout) · exit 10 |
| `light` | 60 / 90 | `read` 40 / 65 · `summary` 10 (own words) · `cards` 10 / 15 (write or review the cards) |
| `setup`, `diagnostic` | ≥ 60 | free-form steps |

- `objectives`: 2–4, observable verbs (write, predict, explain, calculate, measure, build).
- `learn.body`: original explanation, concrete and accurate, with at least one worked example. Code in fenced blocks with a language tag. For math, a small numeric example. For electronics, component values and the expected measured value.
- `practice.tasks`: 2–5, guided → unguided. Every task has `check`; every coding task has test cases or expected output.
- `exit.questions`: 3–5 with answers, testing the objectives (not trivia).
- `cards`: 3–6 atomic question/answer pairs (one fact or idea each).
- `deliverable`: what exists at the end (a commit, a file, a circuit photo, student notes).
- `robo` lessons: `teachBy` (date or null; editable in-app) and `safety` (e.g. never mains voltage; LiPo handling; check polarity before powering).
- **Original content only.** Don't paste textbook passages, video transcripts or problem statements. Reference them by name and link; write your own explanations, examples and exercises.

### 7.3 Quality bar for content

This is a course meant to give a strong foundation, so content quality matters more than volume:
- Explanations are correct, specific and written for a computer engineering graduate whose foundations are rusty: assume intelligence, not knowledge. Natural, human voice; no filler.
- Every Python and C++ code block in `learn`, `practice.solution` and `exit` answers **must run**. `tests/run-lesson-code.mjs` extracts fenced `python` and `cpp` blocks and runs them (`python3`, `g++ -std=c++20`). Blocks that are intentionally partial get the tag `python-snippet` / `cpp-snippet` and are skipped.
- Each week's lessons build on the previous week's, and warm-ups reach back to them.
- Robotics lessons teach in the order his students will meet the material, so his prep notes become his lessons.

---

## 8. App behaviour

### 8.1 Where it lives

- **Don't add a 7th tab** (the tab bar is full). The **Study** tab gets a **Today** card at the top (replacing the old 52-week plan card when the course is active). It lists today's slots with time, track colour dot, lesson title, minutes and status (to do · in progress · done · flagged).
- Tapping a lesson opens **`lesson`** (full-screen, back button). "Open course" opens **`course`**: tracks with progress bars and pace, the week calendar, consolidation weeks marked, teaching deadlines, test scores, settings.
- Home shows the next block and review count through `reminders.js` (§8.9).

### 8.2 Building "Today"

1. Week number `w` from the course start (week 0 between Oct 15 and Oct 18). Find the phase; check consolidation.
2. Get the day's slot template (weekday / Sat / Sun).
3. For each slot, the rotation gives a lane; the lesson shown is **that lane's next unfinished lesson** (lowest `seq` not done), not a lesson pinned to the date. This is what makes "never skip, just shift" work.
4. If that lane's next lesson would be from a later week than `w`, show it marked **ahead**. If its week has no bundled or generated lessons yet, show **"Prepare week N"** (§9.4).
5. Special slots (`mixed`, `buffer`, `test`, `ship`, `review`) are built on the fly (§4, §8.5, §8.6).

### 8.3 The lesson runner

- Shows objectives, resources (tap to open), then the steps as an ordered checklist, each with its minutes.
- **One timer per lesson**, stored as a start timestamp (same approach as the existing focus timer, under a new setting key such as `lessonTimer`), so closing the app doesn't lose it. It shows elapsed vs planned and the current step by time.
- **Warm-up** shows up to 5 due review cards from this track; if none, the static warm-up questions.
- **Practice:** hints reveal one at a time; the solution needs an extra tap ("I've tried; show it") and records that it was revealed.
- **Exit ticket:** he answers (typed or in his head), reveals the answer, marks each right/wrong. Score = right/total. "Grade with Yaver" sends his typed answers to the AI tutor instead.
- **Complete:**
  - Store progress: `{ lessonId, status: 'done', startedAt, completedAt, minutes, score, hintsUsed, solutionsRevealed, notes }`.
  - Log the minutes as a study session for the track's subject via `D.logStudy` (subject names = track names), so streaks, heatmap and stats keep working.
  - Add the lesson's cards to the review deck (first due tomorrow).
  - **Mastery:** score ≥ 0.8 → mastered. Below that → `flagged`: its cards are due tomorrow and it's offered again in the next `buffer` slot.
  - Under 60 minutes: allow it, but ask once ("Planned 90 min, you did 40. Finish anyway?").
- Haptic on step completion, as elsewhere in the app.

### 8.4 Pace per track

For each lane: **expected** = number of that lane's sessions scheduled from week 1 up to now (skipping consolidation weeks); **done** = completed lessons. Show it per track (sum of its lanes): `on plan`, `N behind` or `N ahead`.
Colours: green (on plan or ahead), yellow (behind by less than one week's sessions), red (more).
Rules (show them in the Sunday review):
- Behind → the track simply continues from where he is; nothing is skipped. The `buffer` slot goes to the most-behind track.
- Consistently ahead → pull next week's lessons forward; never add a new subject.
- **Teaching deadlines:** if a `robo` lesson with a `teachBy` date within 7 days isn't done, it's red on Today and Home regardless of pace.

### 8.5 Review cards (spaced repetition)

- Store: `{ id, lessonId, track, front, back, box, due, lapses, history[] }`.
- Intervals by box: 1, 3, 7, 14, 30, 60 days. Grades: **Again** (box 0, due tomorrow, lapses+1), **Hard** (same box, interval ×0.5, min 1 day), **Good** (box+1), **Easy** (box+2).
- The evening `review` slot shows due cards, interleaved across tracks, then a 2-line log ("what went well, what to change") and **tomorrow's plan**: each slot listed as "at 05:50: Python · Conditionals". Confirming it is the implementation intention.
- Reviews count toward the existing review practice counter (`PRACTICE.anki`; keep the key for backup compatibility, relabel it "Card reviews").

### 8.6 Weekly test and Sunday review

- **`test` (Sun 05:50, 90 min):** 20–30 questions: every exit-ticket question from lessons completed this week, plus ~25% drawn from earlier weeks' cards; shuffled so tracks alternate. Self-graded (or "Grade with Yaver"). Store per-track scores. Any track under 70% → its lessons from that week are flagged and their cards are due Monday.
- **`ship` (Sun 07:35, 90 min):** checklist: push the week's project; write the weekly log; review pace per track (§8.4); pick **one** thing to change next week; confirm next week's teaching topics; export next week to the iPhone Calendar; if next week has no lessons yet, **Prepare week N**.

### 8.7 Consolidation weeks (6, 11, 17, 23, …)

No new lessons; track pointers don't advance and pace doesn't count these weeks. About 60% volume:
- Weekdays: `deep1` = retake an earlier test (week 6: the Week 0 diagnostic, compared with the first score), `deep2` = redo flagged practice tasks, `build` = finish and document projects, `review` = clear the card backlog. Other slots free.
- Saturday: `build` only. Sunday: `test` as usual.
- Teaching prep for the following weeks still appears if a `teachBy` deadline needs it.

### 8.8 iPhone Calendar export

"Add this week to iPhone Calendar" (Course screen and Sunday `ship`) builds `.ics` events for every course slot of the week with `openInCalendar()` from `js/ics.js`: title like `Deep 1 · Python: Conditionals`, notes = objectives, alarm at the start (`remind: 0` or 5 minutes before). Include the work and student blocks only if he turns that on. Never create events in the sleep window.

### 8.9 Home reminders

Add plain facts to `reminders.js` (they also feed the AI):
- Next block: "05:50 · Python: Conditionals (90 min)".
- "14 review cards due."
- "Algorithms is 3 lessons behind."
- "Robotics: Voltage dividers is taught in 5 days and not prepared."
- On Sunday: "Weekly test and ship today."

### 8.10 Course settings (inside the Course screen)

Start date (default 2026-10-19), slot times (validated against sleep), whether work/student blocks show, teaching dates per robotics lesson, reset course progress (with confirmation).

---

## 9. The AI tutor

### 9.1 Update `STATIC_SYSTEM` (in `js/ai/claude.js`; Gemini uses the same text)

Replace the sentence about becoming a machine learning engineer with something like:

> The user is Mustafa, a mentor at AQL (Applied Quality Learning) Academy with degrees in computer engineering. He is following an intensive day-by-day course in the app to become an expert AI engineer (data science, ML, deep learning) and robotics engineer, while preparing the robotics course he teaches first-year students (electronics now, Arduino from January 2027, ROS 2 from September 2027). Help him learn, not just finish: use the course tools to see today's lessons, pace and weak spots.

Add to "How to work":
- Teach, don't do. Hints before answers; give a full solution only after he has made an attempt and asks for it.
- Explain naturally, like a sharp colleague: assume he's capable, don't talk down, don't be stiff.
- Sleep 22:30–05:30 is fixed. Never suggest cutting it; if he proposes it, say briefly why that costs more learning than it buys.

Keep the existing rules (short phone-friendly replies, no tables in replies, fenced code, reply in his language).

### 9.2 New tools (in `js/ai/tools.js`; schema + `run`, calling shared functions in `js/course.js`)

| Tool | Input | Returns / does |
| --- | --- | --- |
| `get_course_today` | `{ date? }` | Week, phase, consolidation flag, each slot with time, track, lesson id, title, minutes, status; cards due; pace per track; teaching deadlines. |
| `get_lesson` | `{ lessonId }` | The full lesson object plus his progress on it. |
| `complete_lesson` | `{ lessonId, minutes?, score?, notes? }` | Same as the runner's Complete (logs study, schedules cards, mastery flag). Returns the next lesson in that track. |
| `get_review_cards` | `{ limit?, track? }` | Due cards. |
| `grade_card` | `{ cardId, grade: "again" \| "hard" \| "good" \| "easy" }` | Updates box and due date. |
| `get_course_progress` | `{}` | Per track: done/total, pace, mastery rate, flagged lessons, last test scores; consolidation weeks; next teaching deadlines. |
| `record_test_result` | `{ week, scores: [{ track, right, total }] }` | Stores the weekly test result and flags weak tracks. |
| `save_week_lessons` | `{ week, lessons: [...] }` | Validates generated lessons against §7.2 and the rotation's session counts; stores them; returns precise validation errors so the model can fix and retry. |

Keep schemas Gemini-compatible (plain `type/properties/items/required/enum`; no `oneOf`, `$ref` or `additionalProperties`) and test both providers. Update the tool count wherever docs mention it.

### 9.3 "Tutor me" from a lesson

The lesson screen has **Tutor me**, which calls `openAssistant(...)` with a prompt containing the lesson's title, objectives, current step and the relevant step content, and these rules:
1. Start with the warm-up: ask one recall question at a time; wait; correct briefly.
2. Before explaining, ask him to predict or try (the pretest).
3. Explain with a small concrete example, then check understanding with a question.
4. In practice, use a hint ladder: nudge → hint → partial solution → full solution only on request after an attempt. Review his code by pointing at the problem, not rewriting it.
5. At the end, run the exit ticket one question at a time, then ask for the teach-back, then call `complete_lesson` with the score.
Also add **Quiz me on this week** to the Course screen (uses `get_course_progress` + cards).

### 9.4 Preparing weeks 16 onward

**Prepare week N** (Course screen and Sunday `ship`) asks the active AI to expand week N's outline from `course.json` into day-level lessons matching §7.2 and the rotation, then calls `save_week_lessons`. Generated lessons go into IndexedDB (store `courseLessons`) and are treated exactly like bundled ones. If validation fails, the error goes back to the model to fix (up to 3 attempts), then a clear message is shown. Bundled files always win over generated lessons for the same week.

---

## 10. Storage and migration

- `DB_VERSION` 2 → **3**. New stores: `courseProgress` (key `lessonId`), `cards`, `courseLessons` (generated lessons), `courseTests`, and `tombstones` for sync (§10b). Add them to `STORES` so backup export/import includes them automatically, and check the import of an old v2 backup still works.
- Settings keys (via `db.setSetting`): `course` (active, start date, slot overrides, show work blocks), `lessonTimer`.
- **Course activation:** on first launch after this update, show the Today card with **"Start the course"**. Activating sets the daily study goal from the slot template (about 400 min) and the minimum-day rule to "60 minutes: review cards plus one lesson; never miss two days in a row".
- **Old roadmap:** keep `data/ml-roadmap.json`, `importPlan`, `planStatus` and their tools working, untouched. When the course is active, hide the old plan card and the "Load the ML Engineer roadmap" button; `get_study_plan` should mention that the course is the active plan.

---

## 10b. Laptop and iPhone: one app on both devices

Mustafa studies at his desk for the deep blocks and writes code in VS Code on his laptop, and uses his iPhone the rest of the day. Yaver must work fully on both, and both must show the same progress.

### Running on the laptop

- Same files and the same GitHub Pages URL. It opens in any current desktop browser (Chrome, Edge, Safari, Firefox). No separate build.
- **Installable as a desktop app.** Chrome and Edge: listen for `beforeinstallprompt` and show "Install Yaver on this computer" in Settings when it's available. macOS Safari: File → Add to Dock. Explain both in the README and in Settings.
- Works offline on the laptop too (same service worker).

### Responsive layout

| Width | Layout |
| --- | --- |
| < 700 px (phone) | Today's layout, unchanged. |
| 700–1099 px (tablet or narrow window) | Content up to about 760 px wide; bottom tab bar stays. |
| ≥ 1100 px (laptop, desktop) | A **left sidebar** with the same sections (icon + label) replaces the bottom tab bar; the assistant button becomes a sidebar item; content up to about 1200 px. |

Screen by screen on a laptop:
- **Today:** a vertical day timeline with every slot and a "now" line, and the week as a strip across the top.
- **Lesson runner:** two columns. Left (about 65%): the lesson itself (learn text, worked examples, practice tasks). Right (about 35%, sticky): timer, step checklist with minutes, hints, a notes box, exit-ticket progress and **Tutor me**. From 1400 px, Tutor me opens the chat **docked as a third column** beside the lesson instead of covering it.
- **Course overview:** track cards in a grid (2–3 per row); the week as a 7-column calendar.
- **Review cards:** one centred card, graded from the keyboard.
- Every existing screen (Home, Money, Calendar, Diet, Map, Settings, chat) must also look right at desktop widths: no stretched full-width lines of text (cap line length around 75 characters), sheets centred as dialogs instead of bottom sheets, the map filling the content area.

### Mouse and keyboard

- Visible hover and focus states on everything clickable; sensible Tab order; nothing that only works by touch.
- Keyboard shortcuts, listed in a `?` overlay and ignored while typing in a field:
  - Review cards: `Space` reveal, `1` Again, `2` Hard, `3` Good, `4` Easy.
  - Lesson: `S` start or stop the timer, `N` finish this step and go to the next, `H` next hint, `T` Tutor me, `Esc` back.
  - Anywhere: `G` then `T` → Today, `G` then `C` → Course, `/` → ask Yaver, `?` → shortcuts.
- A **Copy** button on every code block (useful on both devices).

### Helpers that matter most at the laptop

- **Download starter files** on coding practice tasks: a `.py` (or `.cpp`) file with the task as a comment and its `check` turned into runnable tests (pytest for Python, asserts in `main` for C++), named after the lesson, so he can open it straight in VS Code. On the iPhone the same button uses the share sheet.
- Resource links open in a new tab.
- **Desktop notifications** when a slot starts while Yaver is open (Notification API). Ask for permission from a button, never on page load. The `.ics` export (§8.8) also works on the laptop: the downloaded file opens in the computer's calendar app.

### Sync between laptop and iPhone

IndexedDB lives on each device and there is no Yaver server, so without sync the two devices would show different progress. Build sync that needs no server.

- **Where the data goes: one private GitHub Gist** holding a single encrypted file (`yaver-sync.enc`; split into parts if it grows past about 900 KB). The browser talks straight to `api.github.com`. He creates a token that can only touch gists: a fine-grained personal access token with the Gists read-and-write permission if GitHub supports it, otherwise a classic token with only the `gist` scope. Verify which one works and put the exact steps in Settings → Sync.
- **End-to-end encryption.** A secret gist is unlisted, not private, so everything is encrypted on the device before upload with Web Crypto: AES-GCM 256, key derived from a **sync passphrase** with PBKDF2-SHA-256 (at least 310,000 iterations, random salt stored with the ciphertext), a fresh random IV on every upload. The token and passphrase stay on the device like the API keys: never synced, never exported in backups, never logged, never sent to the AI. A wrong passphrase gives a clear error and overwrites nothing.
- **Setting up the second device:** paste the token and passphrase; the app finds the gist by its description ("Yaver sync, encrypted") and pulls it. If none exists, it creates one.
- **What syncs:** every store (course progress, cards, tests, generated lessons, sessions, subjects, milestones, expenses, meetings, meals, tasks) and shared settings (name, about me, currency, budgets and goals, the old plan, course settings, the focus and lesson timers, so he can start a lesson on the laptop and stop it on the phone).
  **Stays on each device:** `apiKey`, `geminiKey`, `provider`, `model`, `effort`, `geminiModel`, `geminiModels`, `speak`, `voiceLang`, `lastLoc`, `onboarded`, all sync settings, and the `chats` store (chat history can be large and holds photos).
- **Merging, record by record:**
  - `db.put` stamps `updatedAt` (ISO time) and `deviceId` on every write; a migration sets `updatedAt = createdAt` on existing rows.
  - `db.remove` records a tombstone `{ store, id, deletedAt }` in a new `tombstones` store.
  - Newest `updatedAt` wins; a tombstone newer than the record deletes it; tombstones older than 90 days are pruned.
  - **Counters must not lose increments.** The practice counters are stored today as one number per day (`practice:<kind>:<date>` in `kv`), so two devices would overwrite each other. Change them to one key per device (`practice:<kind>:<date>:<deviceId>`) and sum across devices in `practiceOn`/`practiceTotal`, migrating existing values. Check for any other incremented value and treat it the same way.
- **When it syncs:** when the app opens, when it comes back to the foreground (`visibilitychange`), 10 seconds after the last local change, and on **Sync now**. Order: pull → merge → push. Use the gist's `updated_at` to detect a push from the other device in between; if it changed, pull and merge again before pushing (at most 3 tries). Offline: keep working and sync later. Never block the screen while syncing.
- **Safety nets:** before the first sync on a device that already has data, save an automatic local backup, and keep the last 3. Never push an empty database over a non-empty one without asking. Keep manual Export/Import working, and change Import to merge by `updatedAt` instead of blindly overwriting (say so next to the button).
- **Where it shows:** Settings → Sync (set up, status such as "Synced 2 min ago from iPhone" or "Offline, will sync later", Sync now, turn off, forget this device), plus a small status dot in the header or sidebar.
- New files: `js/sync.js` (merge and GitHub calls) and `js/crypto.js` (encryption), both added to `sw.js` `FILES`. `DB_VERSION` goes to 3 with the course stores plus `tombstones`.

---

## 11. Tests and validation

1. **`tests/validate-course.mjs`** (Node, no dependencies), run against `data/course/`:
   - Valid JSON; required fields; unique ids; `seq` continuous per lane; `prereqs` exist.
   - Every lesson ≥ 60 minutes and equal to its lane's minutes; step minutes sum to lesson minutes; step kinds match the lesson kind.
   - For every bundled week, lessons per lane **equal** that lane's scheduled sessions in the rotation.
   - 3–5 exit questions, 3–6 cards, ≥ 2 practice tasks where required; every coding task has a `check`.
   - Every URL is `https://` (or a documented exception) and appears in the verified-URL list you produced.
   - Consolidation weeks have no regular lessons.
2. **`tests/run-lesson-code.mjs`**: runs every `python` and `cpp` block; fails on any error.
3. **Extend `tests/smoke.mjs`** (fake the clock with Playwright):
   - 2026-10-15 shows Week 0 (setup lesson).
   - Tue 2026-10-20 06:00: Today shows math in `deep1` and `deep2`, build, robo, ai light, review, with correct times.
   - Open a lesson, start, complete with 4/5 → a study session is logged, cards exist, status mastered; with 2/5 → flagged and in the next buffer slot.
   - Grade a card → due date moves.
   - Week 6 shows consolidation; pace doesn't count it.
   - Sunday shows `test` and `ship`.
   - A simulated Claude turn calls `get_course_today` then `complete_lesson`; a simulated Gemini turn calls `get_course_today`.
   - No console errors on any screen.
4. **Desktop run of the smoke test** at 1440×900 (desktop Chrome profile, mouse, no touch): sidebar shows instead of the tab bar; every screen renders without horizontal scrolling; the lesson runner has two columns; keyboard grading (`Space`, `1`–`4`) and `?` work; Tutor me docks beside the lesson at 1440 px.
5. **Sync test** with two browser contexts ("iPhone" and "laptop") and a mocked `api.github.com`:
   - Each device makes different changes (complete different lessons, grade cards, log practice), then syncs → both end with the union of changes.
   - The same record edited on both → newest `updatedAt` wins. A deletion on one device removes the record on the other.
   - Practice counts added on both devices on the same day add up instead of overwriting.
   - The uploaded gist content is not readable JSON (encrypted); a wrong passphrase fails without changing any data.
   - API keys and chat history never appear in the uploaded payload, even after decrypting it.
6. Run all of these, plus the existing smoke test, before every commit.

---

## 12. Work order (commit after each milestone, tests green)

1. Read the repo (§2). Write `course.json` (tracks, slots, rotations, consolidation weeks, week list with outlines for 16–63, diagnostic) and the two validators.
2. Week 0 and weeks 1–7 lessons. (If you can run parallel subagents, one per week is fine; each must pass the validators.)
3. Weeks 8–15 lessons.
4. `js/course.js` logic + DB v3 stores + migration.
5. Today card, Course screen, lesson runner.
6. Review cards, weekly test, Sunday ship, consolidation, buffer and mixed slots.
7. AI: `STATIC_SYSTEM` update, the 8 tools, Tutor me, Prepare week N.
8. Calendar export, Home reminders, course settings.
9. Desktop: responsive layout for every screen, sidebar, two-column lesson runner, docked tutor, keyboard shortcuts, starter-file download, desktop notifications, install prompt.
10. Sync: `updatedAt`/`deviceId` stamping, tombstones, per-device practice counters (with migration), encryption, GitHub Gist sync, Settings → Sync, merge-based Import.
11. Smoke tests (phone and desktop), sync test, `docs/ARCHITECTURE.md` sections "Course" and "Using Yaver on a laptop, and sync" (update the "only on this phone" wording), README (install on a computer; set up sync), add files to `sw.js` `FILES`, bump `VERSION`.

Keep `main` deployable after every commit (GitHub Pages serves it to his phone).

---

## 13. Definition of done

- [ ] On 2026-10-15 the app shows Week 0; on 2026-10-19 at 05:30 it shows Week 1's day with every slot filled correctly.
- [ ] Every lesson in weeks 0–15 is ≥ 60 minutes, has the full step structure, original content, verified links, runnable code, exit ticket and cards.
- [ ] Python, C++, algorithms, math, AI, robotics, projects and tools are all present, in the order and weeks in §6.
- [ ] Completing a lesson logs a study session, schedules cards, and applies the 80% mastery rule.
- [ ] Pace per track, buffer, mixed practice, weekly test, Sunday ship and consolidation weeks all work as specified.
- [ ] Teaching deadlines for robotics lessons are editable and show in red when close and unprepared.
- [ ] Nothing is ever scheduled between 22:30 and 05:30, and slot edits that would cut sleep below 7 hours are refused.
- [ ] Both Claude and Gemini can read today's plan, tutor a lesson with hints-first rules, complete lessons and grade cards.
- [ ] "Prepare week N" generates and validates weeks 16+.
- [ ] Works offline; backup export/import includes course data; old features and the old roadmap still work.
- [ ] On a laptop, every screen uses the desktop layout (sidebar, two-column lesson runner, docked tutor), works fully by mouse and keyboard, and can be installed as an app.
- [ ] A lesson completed on the laptop shows as done on the iPhone after sync, and the reverse; deletions, timers and practice counts sync correctly; the gist content is encrypted; keys and chats never leave the device.
- [ ] All validators, smoke tests (phone and desktop) and the sync test pass; `sw.js` version bumped; ARCHITECTURE.md and README updated.

## 14. Final summary to write when you finish

Tell Mustafa, in plain language: what was built, how to start (open Yaver → Study → Start the course), how a day works, how to install Yaver on his laptop and connect sync (token and passphrase steps, written for someone doing it for the first time), any choices you made that this prompt didn't cover, and anything you couldn't verify (for example a resource link you replaced with a home page).
