const state = {
  projects: [],
  selectedProjectId: null,
  cards: [],
  projectStats: null,
  theme: "light",
  fontMode: "editorial",
  activeMode: "insert",
  projectsPanelOpen: true,
  editingCardId: null,
  editingOriginalImageUrl: null,
  previewBlobUrl: null,
  study: emptyStudyState(),
};

function emptyStudyState() {
  return {
    active: false,
    paused: false,
    queue: [],
    index: 0,
    results: {},
    startedAt: null,
  };
}

const els = {
  fontMode: document.getElementById("font-mode"),
  themeToggle: document.getElementById("theme-toggle"),
  refreshProjects: document.getElementById("refresh-projects"),
  projectPanelToggle: document.getElementById("project-panel-toggle"),
  newProjectForm: document.getElementById("new-project-form"),
  projectName: document.getElementById("project-name"),
  projectDescription: document.getElementById("project-description"),
  projectList: document.getElementById("project-list"),
  projectItemTemplate: document.getElementById("project-item-template"),
  activeProjectTitle: document.getElementById("active-project-title"),
  stats: document.getElementById("stats"),
  modeButtons: [...document.querySelectorAll(".mode-btn")],
  insertView: document.getElementById("insert-view"),
  studyView: document.getElementById("study-view"),
  manualCardForm: document.getElementById("manual-card-form"),
  cardFormTitle: document.getElementById("card-form-title"),
  cancelEdit: document.getElementById("cancel-edit"),
  manualQuestion: document.getElementById("manual-question"),
  manualDefinition: document.getElementById("manual-definition"),
  manualImage: document.getElementById("manual-image"),
  formImagePreviewWrap: document.getElementById("form-image-preview-wrap"),
  formImagePreview: document.getElementById("form-image-preview"),
  clearImageOnSave: document.getElementById("clear-image-on-save"),
  saveCardButton: document.getElementById("save-card-button"),
  cardsCount: document.getElementById("cards-count"),
  cardsList: document.getElementById("cards-list"),
  listCardTemplate: document.getElementById("list-card-template"),
  startSession: document.getElementById("start-session"),
  pauseSession: document.getElementById("pause-session"),
  resumeSession: document.getElementById("resume-session"),
  endSession: document.getElementById("end-session"),
  studyProgress: document.getElementById("study-progress"),
  studyEmpty: document.getElementById("study-empty"),
  studyStage: document.getElementById("study-stage"),
  flipCard: document.getElementById("flip-card"),
  studyQuestion: document.getElementById("study-question"),
  studyAnswer: document.getElementById("study-answer"),
  studyImageWrap: document.getElementById("study-image-wrap"),
  studyImage: document.getElementById("study-image"),
  flipButton: document.getElementById("flip-button"),
  prevStudy: document.getElementById("prev-study"),
  nextStudy: document.getElementById("next-study"),
  markDidntKnow: document.getElementById("mark-didnt-know"),
  markKnow: document.getElementById("mark-know"),
  studySummary: document.getElementById("study-summary"),
  summaryTitle: document.getElementById("summary-title"),
  summaryBody: document.getElementById("summary-body"),
};

const clearImageRow = els.clearImageOnSave.closest(".checkbox-row");

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

function applyProjectPanelVisibility(isOpen) {
  state.projectsPanelOpen = isOpen;
  document.body.classList.toggle("projects-hidden", !isOpen);
  els.projectPanelToggle.textContent = isOpen ? "Hide projects" : "Show projects";
}

function toggleProjectPanel() {
  applyProjectPanelVisibility(!state.projectsPanelOpen);
}

function setActiveMode(mode) {
  state.activeMode = mode === "study" ? "study" : "insert";
  els.modeButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === state.activeMode);
  });
  els.insertView.classList.toggle("hidden", state.activeMode !== "insert");
  els.studyView.classList.toggle("hidden", state.activeMode !== "study");
}

function statusLabel(status) {
  if (status === "know") return "Know";
  return "Didn't know";
}

function statusClass(status) {
  return status === "know" ? "know" : "didnt";
}

function computeStats(cards) {
  const total = cards.length;
  const know = cards.filter((card) => card.status === "know").length;
  return {
    total_cards: total,
    know_count: know,
    didnt_know_count: total - know,
  };
}

function renderStats() {
  if (!state.projectStats) {
    els.stats.innerHTML = "";
    return;
  }

  els.stats.innerHTML = [
    `<span class="stat">Total: ${state.projectStats.total_cards}</span>`,
    `<span class="stat">Know: ${state.projectStats.know_count}</span>`,
    `<span class="stat">Didn't know: ${state.projectStats.didnt_know_count}</span>`,
  ].join("");
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
    ).textContent = `${project.total_cards} cards | ${project.know_count} known`;
    node.classList.toggle("active", project.id === state.selectedProjectId);
    node.addEventListener("click", () => {
      selectProject(project.id).catch((error) => alert(error.message));
    });
    els.projectList.appendChild(node);
  });
}

function getCardById(cardId) {
  return state.cards.find((card) => card.id === cardId) || null;
}

function clearPreviewBlobUrl() {
  if (state.previewBlobUrl) {
    URL.revokeObjectURL(state.previewBlobUrl);
    state.previewBlobUrl = null;
  }
}

function setFormImagePreview(url, isBlob = false) {
  clearPreviewBlobUrl();

  if (!url) {
    els.formImagePreviewWrap.classList.add("hidden");
    els.formImagePreview.removeAttribute("src");
    return;
  }

  if (isBlob) {
    state.previewBlobUrl = url;
  }

  els.formImagePreview.src = url;
  els.formImagePreviewWrap.classList.remove("hidden");
}

function refreshFormImagePreview() {
  const selected = els.manualImage.files?.[0];
  const clearRequested = els.clearImageOnSave.checked;

  if (selected) {
    const blobUrl = URL.createObjectURL(selected);
    setFormImagePreview(blobUrl, true);
    return;
  }

  if (state.editingOriginalImageUrl && !clearRequested) {
    setFormImagePreview(state.editingOriginalImageUrl, false);
    return;
  }

  setFormImagePreview(null);
}

function renderClearImageVisibility() {
  const hasEditableImage = Boolean(state.editingCardId && state.editingOriginalImageUrl);
  clearImageRow.classList.toggle("hidden", !hasEditableImage);

  if (!hasEditableImage) {
    els.clearImageOnSave.checked = false;
  }
}

function resetCardForm() {
  state.editingCardId = null;
  state.editingOriginalImageUrl = null;
  els.cardFormTitle.textContent = "Add flashcard";
  els.saveCardButton.textContent = "Save flashcard";
  els.cancelEdit.classList.add("hidden");
  els.manualQuestion.value = "";
  els.manualDefinition.value = "";
  els.manualImage.value = "";
  els.clearImageOnSave.checked = false;
  renderClearImageVisibility();
  refreshFormImagePreview();
}

function enterEditMode(cardId) {
  const card = getCardById(cardId);
  if (!card) {
    return;
  }

  state.editingCardId = card.id;
  state.editingOriginalImageUrl = card.image_url || null;
  els.cardFormTitle.textContent = "Edit flashcard";
  els.saveCardButton.textContent = "Save changes";
  els.cancelEdit.classList.remove("hidden");
  els.manualQuestion.value = card.question;
  els.manualDefinition.value = card.definition || card.answer;
  els.manualImage.value = "";
  els.clearImageOnSave.checked = false;
  renderClearImageVisibility();
  refreshFormImagePreview();
  els.manualQuestion.focus();
}

function renderCardsList() {
  els.cardsList.innerHTML = "";

  if (!state.selectedProjectId) {
    els.cardsCount.textContent = "";
    els.cardsList.innerHTML = '<div class="empty-message">Select a project to start adding cards.</div>';
    return;
  }

  els.cardsCount.textContent = `${state.cards.length} card${state.cards.length === 1 ? "" : "s"}`;

  if (!state.cards.length) {
    els.cardsList.innerHTML = '<div class="empty-message">No flashcards yet in this project.</div>';
    return;
  }

  state.cards.forEach((card) => {
    const node = els.listCardTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector(".card-question").textContent = card.question;
    node.querySelector(".card-answer").textContent = card.definition || card.answer;

    const imageWrap = node.querySelector(".list-image-wrap");
    const image = node.querySelector(".list-image");
    if (card.image_url) {
      image.src = card.image_url;
      imageWrap.classList.remove("hidden");
    } else {
      imageWrap.classList.add("hidden");
      image.removeAttribute("src");
    }

    const statusNode = node.querySelector(".status-chip");
    statusNode.className = `status-chip ${statusClass(card.status)}`;
    statusNode.textContent = statusLabel(card.status);

    const editButton = node.querySelector(".edit-card");
    const deleteButton = node.querySelector(".delete-card");
    editButton.addEventListener("click", () => enterEditMode(card.id));
    deleteButton.addEventListener("click", () => {
      deleteCard(card.id).catch((error) => alert(error.message));
    });

    els.cardsList.appendChild(node);
  });
}

function clearProjectViews() {
  els.activeProjectTitle.textContent = "Select a project";
  state.cards = [];
  state.projectStats = null;
  renderStats();
  renderCardsList();
  resetCardForm();
  resetStudySession();
  renderStudy();
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

async function loadSelectedProject() {
  if (!state.selectedProjectId) {
    clearProjectViews();
    return;
  }

  const [projectResponse, cardsResponse] = await Promise.all([
    api(`/api/projects/${state.selectedProjectId}`),
    api(`/api/projects/${state.selectedProjectId}/cards?status=all`),
  ]);

  els.activeProjectTitle.textContent = projectResponse.project.name;
  state.cards = cardsResponse.cards;
  state.projectStats = projectResponse.stats || computeStats(state.cards);
  renderStats();
  renderCardsList();

  resetCardForm();
  resetStudySession();
  renderStudy();
}

async function loadAppData() {
  await fetchProjects();
  renderProjects();
  await loadSelectedProject();
}

async function selectProject(projectId) {
  state.selectedProjectId = projectId;
  renderProjects();
  await loadSelectedProject();
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
  await loadSelectedProject();
}

function buildCardFormData() {
  const formData = new FormData();
  formData.append("question", els.manualQuestion.value.trim());
  formData.append("definition", els.manualDefinition.value.trim());

  const imageFile = els.manualImage.files?.[0];
  if (imageFile) {
    formData.append("image", imageFile);
  }

  if (els.clearImageOnSave.checked) {
    formData.append("clear_image", "true");
  }

  return formData;
}

async function saveCard(event) {
  event.preventDefault();

  if (!state.selectedProjectId) {
    alert("Create or select a project first.");
    return;
  }

  const question = els.manualQuestion.value.trim();
  const definition = els.manualDefinition.value.trim();
  if (!question || !definition) {
    return;
  }

  const formData = buildCardFormData();

  if (state.editingCardId) {
    await api(`/api/cards/${state.editingCardId}`, {
      method: "PATCH",
      body: formData,
    });
  } else {
    await api(`/api/projects/${state.selectedProjectId}/cards`, {
      method: "POST",
      body: formData,
    });
  }

  await fetchProjects();
  renderProjects();
  await loadSelectedProject();
  els.manualQuestion.focus();
}

async function deleteCard(cardId) {
  const card = getCardById(cardId);
  if (!card) {
    return;
  }

  const confirmed = window.confirm("Delete this flashcard? This cannot be undone.");
  if (!confirmed) {
    return;
  }

  await api(`/api/cards/${cardId}`, { method: "DELETE" });

  await fetchProjects();
  renderProjects();
  await loadSelectedProject();
}

function resetStudySession() {
  state.study = emptyStudyState();
  els.flipCard.classList.remove("flipped");
  els.studySummary.classList.add("hidden");
  els.summaryTitle.textContent = "Session summary";
  els.summaryBody.innerHTML = "";
}

function getStudyCard() {
  const currentId = state.study.queue[state.study.index];
  return state.cards.find((card) => card.id === currentId) || null;
}

function renderStudyCard() {
  const card = getStudyCard();
  if (!card) {
    return;
  }

  els.studyQuestion.textContent = card.question;
  els.studyAnswer.textContent = card.definition || card.answer;
  if (card.image_url) {
    els.studyImage.src = card.image_url;
    els.studyImageWrap.classList.remove("hidden");
  } else {
    els.studyImageWrap.classList.add("hidden");
    els.studyImage.removeAttribute("src");
  }
  els.flipCard.classList.remove("flipped");
}

function summaryCounts() {
  const statuses = Object.values(state.study.results);
  const know = statuses.filter((value) => value === "know").length;
  const didntKnow = statuses.filter((value) => value === "didnt_know").length;
  const reviewed = statuses.length;
  const mastery = reviewed ? Math.round((know / reviewed) * 100) : 0;
  return { reviewed, know, didntKnow, mastery };
}

function showStudySummary(title) {
  const totals = summaryCounts();
  const totalCards = state.study.queue.length;
  const remaining = Math.max(totalCards - totals.reviewed, 0);

  els.summaryTitle.textContent = title;
  els.summaryBody.innerHTML = `
    <p><strong>Reviewed:</strong> ${totals.reviewed} / ${totalCards}</p>
    <p><strong>Know:</strong> ${totals.know}</p>
    <p><strong>Didn't know:</strong> ${totals.didntKnow}</p>
    <p><strong>Mastery:</strong> ${totals.mastery}%</p>
    <p><strong>Remaining:</strong> ${remaining}</p>
  `;
  els.studySummary.classList.remove("hidden");
}

function renderStudy() {
  const hasProject = Boolean(state.selectedProjectId);
  const hasCards = state.cards.length > 0;
  const hasQueue = state.study.queue.length > 0;

  els.startSession.classList.toggle(
    "hidden",
    !hasProject || !hasCards || state.study.active || state.study.paused
  );
  els.startSession.textContent = hasQueue ? "Restart session" : "Start session";
  els.pauseSession.classList.toggle("hidden", !state.study.active);
  els.resumeSession.classList.toggle("hidden", !(state.study.paused && hasQueue));
  els.endSession.classList.toggle("hidden", !(hasQueue && (state.study.active || state.study.paused)));
  const canRate = state.study.active && hasQueue;
  els.markKnow.disabled = !canRate;
  els.markDidntKnow.disabled = !canRate;
  els.flipButton.disabled = !hasQueue;
  els.prevStudy.disabled = !hasQueue;
  els.nextStudy.disabled = !hasQueue;

  if (!hasProject) {
    els.studyEmpty.classList.remove("hidden");
    els.studyEmpty.textContent = "Select a project to begin studying.";
    els.studyStage.classList.add("hidden");
    els.studyProgress.textContent = "";
    return;
  }

  if (!hasCards) {
    els.studyEmpty.classList.remove("hidden");
    els.studyEmpty.textContent = "Add cards in Insert mode to start a study session.";
    els.studyStage.classList.add("hidden");
    els.studyProgress.textContent = "";
    return;
  }

  if (!hasQueue) {
    els.studyEmpty.classList.remove("hidden");
    els.studyEmpty.textContent = "Press Start session to begin.";
    els.studyStage.classList.add("hidden");
    els.studyProgress.textContent = "";
    return;
  }

  els.studyEmpty.classList.add("hidden");
  els.studyStage.classList.remove("hidden");

  const reviewed = Object.keys(state.study.results).length;
  els.studyProgress.textContent = `Card ${state.study.index + 1}/${state.study.queue.length} | Reviewed ${reviewed}`;

  renderStudyCard();
}

function startStudySession() {
  if (!state.cards.length) {
    alert("This project has no flashcards yet.");
    return;
  }

  state.study = {
    active: true,
    paused: false,
    queue: state.cards.map((card) => card.id),
    index: 0,
    results: {},
    startedAt: Date.now(),
  };

  els.studySummary.classList.add("hidden");
  renderStudy();
}

function pauseStudySession() {
  if (!state.study.active) {
    return;
  }

  state.study.active = false;
  state.study.paused = true;
  renderStudy();
  showStudySummary("Session paused");
}

function resumeStudySession() {
  if (!state.study.paused || !state.study.queue.length) {
    return;
  }

  state.study.active = true;
  state.study.paused = false;
  els.studySummary.classList.add("hidden");
  renderStudy();
}

function endStudySession() {
  if (!state.study.queue.length) {
    return;
  }

  state.study.active = false;
  state.study.paused = false;
  renderStudy();
  showStudySummary("Session ended");
}

function finishStudySession() {
  state.study.active = false;
  state.study.paused = false;
  renderStudy();
  showStudySummary("Session complete");
}

function moveStudy(step) {
  if (!state.study.queue.length) {
    return;
  }

  const total = state.study.queue.length;
  state.study.index = (state.study.index + step + total) % total;
  renderStudy();
}

function flipStudyCard() {
  if (!state.study.queue.length) {
    return;
  }
  els.flipCard.classList.toggle("flipped");
}

async function markCurrentCard(status) {
  if (!state.study.active) {
    return;
  }

  const card = getStudyCard();
  if (!card) {
    return;
  }

  const { card: updated } = await api(`/api/cards/${card.id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });

  state.cards = state.cards.map((item) => (item.id === updated.id ? updated : item));
  state.study.results[card.id] = status;
  state.projectStats = computeStats(state.cards);
  renderStats();
  renderCardsList();

  if (state.study.index >= state.study.queue.length - 1) {
    finishStudySession();
    return;
  }

  state.study.index += 1;
  els.flipCard.classList.remove("flipped");
  renderStudy();
}

function wireEvents() {
  els.fontMode.addEventListener("change", () => applyFontMode(els.fontMode.value));
  els.themeToggle.addEventListener("click", toggleTheme);
  els.refreshProjects.addEventListener("click", () => {
    loadAppData().catch((error) => alert(error.message));
  });
  els.projectPanelToggle.addEventListener("click", toggleProjectPanel);

  els.modeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setActiveMode(button.dataset.mode);
    });
  });

  els.newProjectForm.addEventListener("submit", (event) => {
    createProject(event).catch((error) => alert(error.message));
  });

  els.manualCardForm.addEventListener("submit", (event) => {
    saveCard(event).catch((error) => alert(error.message));
  });

  els.cancelEdit.addEventListener("click", () => {
    resetCardForm();
  });

  els.manualImage.addEventListener("change", refreshFormImagePreview);
  els.clearImageOnSave.addEventListener("change", refreshFormImagePreview);

  els.startSession.addEventListener("click", startStudySession);
  els.pauseSession.addEventListener("click", pauseStudySession);
  els.resumeSession.addEventListener("click", resumeStudySession);
  els.endSession.addEventListener("click", endStudySession);
  els.flipButton.addEventListener("click", flipStudyCard);
  els.prevStudy.addEventListener("click", () => moveStudy(-1));
  els.nextStudy.addEventListener("click", () => moveStudy(1));
  els.markDidntKnow.addEventListener("click", () => {
    markCurrentCard("didnt_know").catch((error) => alert(error.message));
  });
  els.markKnow.addEventListener("click", () => {
    markCurrentCard("know").catch((error) => alert(error.message));
  });
}

async function boot() {
  applyTheme(preferredTheme());
  applyFontMode(preferredFontMode());
  applyProjectPanelVisibility(true);
  setActiveMode("insert");
  wireEvents();
  renderClearImageVisibility();
  refreshFormImagePreview();
  await loadAppData();
}

boot().catch((error) => {
  console.error(error);
  alert("Failed to load app.");
});
