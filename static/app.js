const state = {
  projects: [],
  selectedProjectId: null,
  topics: [],
  cards: [],
  filteredCards: [],
  currentCardIndex: 0,
  statusFilter: "all",
  topicFilter: "all",
  theme: "light",
  fontMode: "editorial",
};

const els = {
  fontMode: document.getElementById("font-mode"),
  themeToggle: document.getElementById("theme-toggle"),
  refreshProjects: document.getElementById("refresh-projects"),
  newProjectForm: document.getElementById("new-project-form"),
  projectName: document.getElementById("project-name"),
  projectDescription: document.getElementById("project-description"),
  projectList: document.getElementById("project-list"),
  projectItemTemplate: document.getElementById("project-item-template"),
  newTopicForm: document.getElementById("new-topic-form"),
  topicName: document.getElementById("topic-name"),
  topicList: document.getElementById("topic-list"),
  topicChipTemplate: document.getElementById("topic-chip-template"),
  topicsCaption: document.getElementById("topics-caption"),
  activeProjectTitle: document.getElementById("active-project-title"),
  stats: document.getElementById("stats"),
  manualCardForm: document.getElementById("manual-card-form"),
  cardTopicSelect: document.getElementById("card-topic-select"),
  manualQuestion: document.getElementById("manual-question"),
  manualDefinition: document.getElementById("manual-definition"),
  filters: [...document.querySelectorAll(".filter")],
  studyTopicFilter: document.getElementById("study-topic-filter"),
  emptyStudy: document.getElementById("empty-study"),
  cardShell: document.getElementById("card-shell"),
  cardProgress: document.getElementById("card-progress"),
  cardTopicPill: document.getElementById("card-topic-pill"),
  cardQuestion: document.getElementById("card-question"),
  cardDefinition: document.getElementById("card-definition"),
  definitionBlock: document.getElementById("definition-block"),
  showDefinition: document.getElementById("show-definition"),
  prevCard: document.getElementById("prev-card"),
  nextCard: document.getElementById("next-card"),
  ratingButtons: [...document.querySelectorAll(".rating")],
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(options.headers || {}),
    },
    ...options,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }
  return data;
}

function preferredTheme() {
  const saved = window.localStorage.getItem("flashcard-maker-theme");
  const legacySaved = window.localStorage.getItem("flashforge-theme");
  const candidate = saved || legacySaved;
  if (candidate === "light" || candidate === "dark") {
    return candidate;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function preferredFontMode() {
  const saved = window.localStorage.getItem("flashcard-maker-font-mode");
  if (saved === "editorial" || saved === "clean") {
    return saved;
  }
  return "editorial";
}

function applyTheme(theme) {
  state.theme = theme;
  document.documentElement.setAttribute("data-theme", theme);
  window.localStorage.setItem("flashcard-maker-theme", theme);
  els.themeToggle.textContent = theme === "dark" ? "Light mode" : "Dark mode";
}

function toggleTheme() {
  applyTheme(state.theme === "dark" ? "light" : "dark");
}

function applyFontMode(mode) {
  const nextMode = mode === "clean" ? "clean" : "editorial";
  state.fontMode = nextMode;
  document.documentElement.setAttribute("data-font-mode", nextMode);
  window.localStorage.setItem("flashcard-maker-font-mode", nextMode);
  els.fontMode.value = nextMode;
}

function setStatusFilter(filter) {
  state.statusFilter = filter;
  els.filters.forEach((button) => {
    button.classList.toggle("active", button.dataset.filter === filter);
  });
}

function formatStatus(status) {
  if (status === "know") return "Know";
  if (status === "kind_of_know") return "Kind of know";
  return "Don't know";
}

function renderProjects() {
  els.projectList.innerHTML = "";

  if (!state.projects.length) {
    const empty = document.createElement("div");
    empty.className = "empty-message";
    empty.textContent = "No projects yet.";
    els.projectList.appendChild(empty);
    return;
  }

  state.projects.forEach((project) => {
    const node = els.projectItemTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector(".project-title").textContent = project.name;
    node.querySelector(
      ".project-meta"
    ).textContent = `${project.topic_count} topics | ${project.total_cards} cards`;
    node.classList.toggle("active", project.id === state.selectedProjectId);
    node.addEventListener("click", () => {
      selectProject(project.id).catch((error) => alert(error.message));
    });
    els.projectList.appendChild(node);
  });
}

function renderTopics() {
  els.topicList.innerHTML = "";

  if (!state.selectedProjectId) {
    els.topicsCaption.textContent = "Pick a project";
    els.topicList.innerHTML = '<div class="empty-message">Select a project first.</div>';
    return;
  }

  els.topicsCaption.textContent = `${state.topics.length} topic${state.topics.length === 1 ? "" : "s"}`;

  if (!state.topics.length) {
    els.topicList.innerHTML = '<div class="empty-message">No topics yet.</div>';
    return;
  }

  state.topics.forEach((topic) => {
    const chip = els.topicChipTemplate.content.firstElementChild.cloneNode(true);
    chip.textContent = `${topic.name} (${topic.card_count})`;
    els.topicList.appendChild(chip);
  });
}

function setSelectOptions(select, options, defaultLabel, includeAll = false) {
  const previousValue = select.value;
  select.innerHTML = "";

  if (includeAll) {
    const allOption = document.createElement("option");
    allOption.value = "all";
    allOption.textContent = defaultLabel;
    select.appendChild(allOption);
  } else {
    const noneOption = document.createElement("option");
    noneOption.value = "";
    noneOption.textContent = defaultLabel;
    select.appendChild(noneOption);
  }

  options.forEach((topic) => {
    const option = document.createElement("option");
    option.value = String(topic.id);
    option.textContent = topic.name;
    select.appendChild(option);
  });

  const hasPreviousValue = [...select.options].some((option) => option.value === previousValue);
  select.value = hasPreviousValue ? previousValue : includeAll ? "all" : "";
}

function renderProjectDetails(details) {
  if (!details) {
    els.activeProjectTitle.textContent = "Select a project";
    els.stats.innerHTML = "";
    state.topics = [];
    renderTopics();
    setSelectOptions(els.cardTopicSelect, [], "No topic", false);
    setSelectOptions(els.studyTopicFilter, [], "All topics", true);
    return;
  }

  els.activeProjectTitle.textContent = details.project.name;

  const stats = details.stats;
  els.stats.innerHTML = [
    `<span class="stat">Total: ${stats.total_cards}</span>`,
    `<span class="stat">Know: ${stats.know_count}</span>`,
    `<span class="stat">Kind of know: ${stats.kind_of_know_count}</span>`,
    `<span class="stat">Don't know: ${stats.dont_know_count}</span>`,
  ].join("");

  state.topics = details.topics;
  renderTopics();
  setSelectOptions(els.cardTopicSelect, details.topics, "No topic", false);
  setSelectOptions(els.studyTopicFilter, details.topics, "All topics", true);

  if (!["all", ...details.topics.map((topic) => String(topic.id))].includes(state.topicFilter)) {
    state.topicFilter = "all";
    els.studyTopicFilter.value = "all";
  }
}

function applyFilters() {
  state.filteredCards = state.cards.filter((card) => {
    const statusPass = state.statusFilter === "all" || card.status === state.statusFilter;
    const topicPass = state.topicFilter === "all" || String(card.topic_id || "") === state.topicFilter;
    return statusPass && topicPass;
  });

  if (state.currentCardIndex >= state.filteredCards.length) {
    state.currentCardIndex = 0;
  }

  renderCurrentCard();
}

function renderCurrentCard() {
  const total = state.filteredCards.length;

  if (!total) {
    els.cardShell.classList.add("hidden");
    els.emptyStudy.classList.remove("hidden");
    return;
  }

  const card = state.filteredCards[state.currentCardIndex];

  els.emptyStudy.classList.add("hidden");
  els.cardShell.classList.remove("hidden");
  els.cardProgress.textContent = `Card ${state.currentCardIndex + 1}/${total} | ${formatStatus(card.status)}`;
  els.cardTopicPill.textContent = card.topic_name || "No topic";
  els.cardQuestion.textContent = card.question;
  els.cardDefinition.textContent = card.definition || card.answer;
  els.definitionBlock.classList.add("hidden");
}

async function fetchProjects() {
  const { projects } = await api("/api/projects");
  state.projects = projects;

  if (!state.selectedProjectId && projects.length) {
    state.selectedProjectId = projects[0].id;
  }

  const selectedExists = projects.some((project) => project.id === state.selectedProjectId);
  if (!selectedExists) {
    state.selectedProjectId = projects.length ? projects[0].id : null;
  }
}

async function hydrateSelectedProject() {
  if (!state.selectedProjectId) {
    renderProjectDetails(null);
    state.cards = [];
    applyFilters();
    return;
  }

  const [details, cardsResponse] = await Promise.all([
    api(`/api/projects/${state.selectedProjectId}`),
    api(`/api/projects/${state.selectedProjectId}/cards?status=all&topic_id=all`),
  ]);

  renderProjectDetails(details);
  state.cards = cardsResponse.cards;
  state.topicFilter = els.studyTopicFilter.value;
  applyFilters();
}

async function loadAppData() {
  await fetchProjects();
  renderProjects();
  await hydrateSelectedProject();
}

async function selectProject(projectId) {
  state.selectedProjectId = projectId;
  renderProjects();
  await hydrateSelectedProject();
}

async function createProject(event) {
  event.preventDefault();

  const name = els.projectName.value.trim();
  const description = els.projectDescription.value.trim();
  if (!name) {
    return;
  }

  const { project } = await api("/api/projects", {
    method: "POST",
    body: JSON.stringify({ name, description }),
  });

  els.newProjectForm.reset();
  await fetchProjects();
  state.selectedProjectId = project.id;
  renderProjects();
  await hydrateSelectedProject();
}

async function createTopic(event) {
  event.preventDefault();

  if (!state.selectedProjectId) {
    alert("Create or select a project first.");
    return;
  }

  const name = els.topicName.value.trim();
  if (!name) {
    return;
  }

  const { topic } = await api(`/api/projects/${state.selectedProjectId}/topics`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });

  els.topicName.value = "";
  await fetchProjects();
  renderProjects();
  await hydrateSelectedProject();
  els.cardTopicSelect.value = String(topic.id);
}

async function addCard(event) {
  event.preventDefault();

  if (!state.selectedProjectId) {
    alert("Create or select a project first.");
    return;
  }

  const question = els.manualQuestion.value.trim();
  const definition = els.manualDefinition.value.trim();
  const topicId = els.cardTopicSelect.value;

  if (!question || !definition) {
    return;
  }

  await api(`/api/projects/${state.selectedProjectId}/cards`, {
    method: "POST",
    body: JSON.stringify({
      question,
      definition,
      topic_id: topicId || null,
    }),
  });

  els.manualQuestion.value = "";
  els.manualDefinition.value = "";
  els.manualQuestion.focus();

  await fetchProjects();
  renderProjects();
  await hydrateSelectedProject();
  setStatusFilter("all");
  applyFilters();
}

async function rateCurrentCard(status) {
  if (!state.filteredCards.length) {
    return;
  }

  const card = state.filteredCards[state.currentCardIndex];

  const { card: updated } = await api(`/api/cards/${card.id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });

  state.cards = state.cards.map((item) => (item.id === updated.id ? updated : item));
  applyFilters();
  await fetchProjects();
  renderProjects();
}

function moveCard(step) {
  if (!state.filteredCards.length) {
    return;
  }

  const total = state.filteredCards.length;
  state.currentCardIndex = (state.currentCardIndex + step + total) % total;
  renderCurrentCard();
}

function wireEvents() {
  els.fontMode.addEventListener("change", () => {
    applyFontMode(els.fontMode.value);
  });

  els.themeToggle.addEventListener("click", toggleTheme);

  els.refreshProjects.addEventListener("click", () => {
    loadAppData().catch((error) => alert(error.message));
  });

  els.newProjectForm.addEventListener("submit", (event) => {
    createProject(event).catch((error) => alert(error.message));
  });

  els.newTopicForm.addEventListener("submit", (event) => {
    createTopic(event).catch((error) => alert(error.message));
  });

  els.manualCardForm.addEventListener("submit", (event) => {
    addCard(event).catch((error) => alert(error.message));
  });

  els.studyTopicFilter.addEventListener("change", () => {
    state.topicFilter = els.studyTopicFilter.value;
    applyFilters();
  });

  els.filters.forEach((button) => {
    button.addEventListener("click", () => {
      setStatusFilter(button.dataset.filter);
      applyFilters();
    });
  });

  els.showDefinition.addEventListener("click", () => {
    els.definitionBlock.classList.remove("hidden");
  });

  els.prevCard.addEventListener("click", () => moveCard(-1));
  els.nextCard.addEventListener("click", () => moveCard(1));

  els.ratingButtons.forEach((button) => {
    button.addEventListener("click", () => {
      rateCurrentCard(button.dataset.status).catch((error) => alert(error.message));
    });
  });
}

async function boot() {
  applyTheme(preferredTheme());
  applyFontMode(preferredFontMode());
  setStatusFilter("all");
  state.topicFilter = "all";
  wireEvents();
  await loadAppData();
}

boot().catch((error) => {
  console.error(error);
  alert("Failed to load app.");
});
