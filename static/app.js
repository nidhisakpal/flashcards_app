const state = {
  projects: [],
  selectedProjectId: null,
  cards: [],
  filteredCards: [],
  currentCardIndex: 0,
  filter: "all",
};

const els = {
  projectList: document.getElementById("project-list"),
  refreshProjects: document.getElementById("refresh-projects"),
  activeProjectTitle: document.getElementById("active-project-title"),
  generatorLabel: document.getElementById("generator-label"),
  sourceList: document.getElementById("source-list"),
  stats: document.getElementById("stats"),
  cardShell: document.getElementById("card-shell"),
  emptyStudy: document.getElementById("empty-study"),
  cardProgress: document.getElementById("card-progress"),
  cardQuestion: document.getElementById("card-question"),
  cardAnswer: document.getElementById("card-answer"),
  answerBlock: document.getElementById("answer-block"),
  showAnswer: document.getElementById("show-answer"),
  prevCard: document.getElementById("prev-card"),
  nextCard: document.getElementById("next-card"),
  newProjectForm: document.getElementById("new-project-form"),
  projectName: document.getElementById("project-name"),
  projectDescription: document.getElementById("project-description"),
  uploadForm: document.getElementById("upload-form"),
  lectureFile: document.getElementById("lecture-file"),
  cardCount: document.getElementById("card-count"),
  manualCardForm: document.getElementById("manual-card-form"),
  manualQuestion: document.getElementById("manual-question"),
  manualAnswer: document.getElementById("manual-answer"),
  filters: [...document.querySelectorAll(".filter")],
  ratingButtons: [...document.querySelectorAll(".rating")],
  projectItemTemplate: document.getElementById("project-item-template"),
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

function setActiveFilter(filter) {
  state.filter = filter;
  els.filters.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.filter === filter);
  });
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
    ).textContent = `${project.total_cards} cards | K:${project.know_count} MK:${project.kind_of_know_count} DK:${project.dont_know_count}`;
    node.classList.toggle("active", project.id === state.selectedProjectId);
    node.addEventListener("click", () => selectProject(project.id));
    els.projectList.appendChild(node);
  });
}

function renderProjectMeta(projectDetails) {
  if (!projectDetails) {
    els.activeProjectTitle.textContent = "Pick a project";
    els.stats.innerHTML = "";
    els.sourceList.innerHTML = "";
    return;
  }

  els.activeProjectTitle.textContent = projectDetails.project.name;

  const stats = projectDetails.stats;
  els.stats.innerHTML = [
    `<span class="stat">Total: ${stats.total_cards}</span>`,
    `<span class="stat">Know: ${stats.know_count}</span>`,
    `<span class="stat">Kind of Know: ${stats.kind_of_know_count}</span>`,
    `<span class="stat">Don't Know: ${stats.dont_know_count}</span>`,
  ].join("");

  if (!projectDetails.sources.length) {
    els.sourceList.innerHTML = '<div class="empty-message">No uploaded lectures yet.</div>';
    return;
  }

  els.sourceList.innerHTML = projectDetails.sources
    .map(
      (source) =>
        `<div class="source-item"><strong>${source.filename}</strong><div class="mono">Uploaded ${new Date(
          source.created_at
        ).toLocaleString()}</div></div>`
    )
    .join("");
}

function applyCardFilter() {
  state.filteredCards =
    state.filter === "all"
      ? [...state.cards]
      : state.cards.filter((card) => card.status === state.filter);

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

  els.emptyStudy.classList.add("hidden");
  els.cardShell.classList.remove("hidden");

  const card = state.filteredCards[state.currentCardIndex];
  els.cardProgress.textContent = `Card ${state.currentCardIndex + 1} / ${total} | Status: ${formatStatus(
    card.status
  )}`;
  els.cardQuestion.textContent = card.question;
  els.cardAnswer.textContent = card.answer;
  els.answerBlock.classList.add("hidden");
}

function formatStatus(status) {
  if (status === "know") return "Know";
  if (status === "kind_of_know") return "Kind of Know";
  return "Don't Know";
}

async function loadProjects() {
  const { projects } = await api("/api/projects");
  state.projects = projects;

  if (!state.selectedProjectId && projects.length) {
    state.selectedProjectId = projects[0].id;
  }

  const selectedStillExists = projects.some((p) => p.id === state.selectedProjectId);
  if (!selectedStillExists && projects.length) {
    state.selectedProjectId = projects[0].id;
  }

  renderProjects();

  if (state.selectedProjectId) {
    await hydrateSelectedProject();
  } else {
    renderProjectMeta(null);
    state.cards = [];
    applyCardFilter();
  }
}

async function hydrateSelectedProject() {
  if (!state.selectedProjectId) return;
  const details = await api(`/api/projects/${state.selectedProjectId}`);
  renderProjectMeta(details);

  const { cards } = await api(`/api/projects/${state.selectedProjectId}/cards?status=all`);
  state.cards = cards;
  applyCardFilter();
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
  if (!name) return;

  const payload = { name, description };
  await api("/api/projects", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  els.newProjectForm.reset();
  await loadProjects();
}

async function uploadAndGenerate(event) {
  event.preventDefault();

  if (!state.selectedProjectId) {
    alert("Create or select a project first.");
    return;
  }

  const file = els.lectureFile.files?.[0];
  if (!file) {
    alert("Pick a PDF or PPTX file.");
    return;
  }

  const formData = new FormData();
  formData.append("file", file);
  formData.append("card_count", els.cardCount.value || "20");

  disableForm(els.uploadForm, true);
  try {
    const result = await api(`/api/projects/${state.selectedProjectId}/upload`, {
      method: "POST",
      body: formData,
    });
    els.generatorLabel.textContent = `Generator: ${result.generator}`;
    els.uploadForm.reset();
    els.cardCount.value = "20";
    await loadProjects();
    setActiveFilter("all");
    applyCardFilter();
  } catch (error) {
    alert(error.message);
  } finally {
    disableForm(els.uploadForm, false);
  }
}

function disableForm(form, disabled) {
  [...form.querySelectorAll("input,textarea,button")].forEach((el) => {
    el.disabled = disabled;
  });
}

async function rateCurrentCard(status) {
  if (!state.filteredCards.length) return;
  const card = state.filteredCards[state.currentCardIndex];

  const { card: updated } = await api(`/api/cards/${card.id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });

  state.cards = state.cards.map((c) => (c.id === updated.id ? updated : c));
  applyCardFilter();
  await loadProjects();
}

function moveCard(step) {
  if (!state.filteredCards.length) return;
  const total = state.filteredCards.length;
  state.currentCardIndex = (state.currentCardIndex + step + total) % total;
  renderCurrentCard();
}

async function addManualCard(event) {
  event.preventDefault();

  if (!state.selectedProjectId) {
    alert("Create or select a project first.");
    return;
  }

  const question = els.manualQuestion.value.trim();
  const answer = els.manualAnswer.value.trim();
  if (!question || !answer) return;

  await api(`/api/projects/${state.selectedProjectId}/cards`, {
    method: "POST",
    body: JSON.stringify({ question, answer }),
  });

  els.manualCardForm.reset();
  await loadProjects();
  setActiveFilter("all");
  applyCardFilter();
}

function wireEvents() {
  els.newProjectForm.addEventListener("submit", (event) => {
    createProject(event).catch((error) => alert(error.message));
  });

  els.refreshProjects.addEventListener("click", () => {
    loadProjects().catch((error) => alert(error.message));
  });

  els.uploadForm.addEventListener("submit", (event) => {
    uploadAndGenerate(event).catch((error) => alert(error.message));
  });

  els.manualCardForm.addEventListener("submit", (event) => {
    addManualCard(event).catch((error) => alert(error.message));
  });

  els.showAnswer.addEventListener("click", () => {
    els.answerBlock.classList.remove("hidden");
  });

  els.prevCard.addEventListener("click", () => moveCard(-1));
  els.nextCard.addEventListener("click", () => moveCard(1));

  els.filters.forEach((filterBtn) => {
    filterBtn.addEventListener("click", () => {
      setActiveFilter(filterBtn.dataset.filter);
      applyCardFilter();
    });
  });

  els.ratingButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      rateCurrentCard(btn.dataset.status).catch((error) => alert(error.message));
    });
  });
}

async function boot() {
  wireEvents();
  setActiveFilter("all");
  await loadProjects();
}

boot().catch((error) => {
  console.error(error);
  alert("Failed to load app.");
});
