const TRIVIA_WIDGET_ASSET_BASE = new URL(".", document.currentScript?.src || window.location.href);

class TriviaWidget extends HTMLElement {
  static get observedAttributes() {
    return ["src"];
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.state = {
      questions: [],
      title: "Trivia",
      current: 0,
      selected: null,
      discarded: new Set(),
      usedHelp: 0,
      score: 0,
      finished: false,
      loading: true,
      error: "",
      questionHelpUsed: new Set(),
      transitionKey: 0,
      timeLeft: 15,
      results: [],
      animateQuestion: false,
      pointAward: 0,
      animatedDiscarded: new Set(),
      streakProgress: 0,
      streakBonus: 0,
      consecutiveCorrect: 0,
      bestStreak: 0,
    };
    this.timerId = null;
    this.timerDuration = 15000;
    this.timerStartedAt = 0;
  }

  connectedCallback() {
    this.loadTrivia();
  }

  disconnectedCallback() {
    this.stopTimer();
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (name === "src" && oldValue !== newValue && this.isConnected) {
      this.loadTrivia();
    }
  }

  async loadTrivia() {
    this.stopTimer();
    this.setState({ loading: true, error: "", finished: false });

    try {
      const inlineData = this.querySelector('script[type="application/json"]');
      const src = this.getAttribute("src");
      let data;

      if (src) {
        const response = await fetch(src, { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`No se pudo cargar el JSON (${response.status})`);
        }
        data = await response.json();
      } else if (inlineData) {
        data = JSON.parse(inlineData.textContent);
      } else {
        throw new Error("Falta el atributo src o un JSON inline.");
      }

      const normalized = this.normalizeData(data);
      this.state = {
        ...this.state,
        ...normalized,
        current: 0,
        selected: null,
        discarded: new Set(),
        usedHelp: 0,
        score: 0,
        finished: false,
        loading: false,
        error: "",
        questionHelpUsed: new Set(),
        transitionKey: 0,
        timeLeft: 15,
        results: Array(normalized.questions.length).fill(null),
        animateQuestion: false,
        pointAward: 0,
        animatedDiscarded: new Set(),
        streakProgress: 0,
        streakBonus: 0,
        consecutiveCorrect: 0,
        bestStreak: 0,
      };
      this.render();
      this.startTimer();
    } catch (error) {
      this.setState({
        loading: false,
        error: error.message || "No se pudo iniciar la trivia.",
      });
    }
  }

  normalizeData(data) {
    if (!data || !Array.isArray(data.questions) || data.questions.length === 0) {
      throw new Error("El JSON debe incluir un array questions con al menos una pregunta.");
    }

    const questions = data.questions.map((item, index) => {
      const options = Array.isArray(item.options)
        ? item.options
        : [item.option1, item.option2, item.option3, item.option4].filter(Boolean);

      if (!item.question || options.length !== 4) {
        throw new Error(`La pregunta ${index + 1} debe tener texto y 4 opciones.`);
      }

      const rawAnswer = item.correctOption ?? item.answer ?? item.correctAnswer;
      const correctIndex = Number(rawAnswer) >= 1 ? Number(rawAnswer) - 1 : Number(rawAnswer);

      if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex > 3) {
        throw new Error(`La pregunta ${index + 1} debe indicar una respuesta correcta entre 1 y 4.`);
      }

      return {
        question: String(item.question),
        options: options.map(String),
        correctIndex,
        explanation: String(item.explanation || "Respuesta correcta."),
      };
    });

    return {
      title: String(data.title || "Trivia"),
      intro: String(data.intro || ""),
      questions,
    };
  }

  setState(partialState) {
    this.state = { ...this.state, ...partialState };
    this.render();
  }

  currentQuestion() {
    return this.state.questions[this.state.current];
  }

  maxPossibleScore() {
    return this.state.questions.length * 15 + Math.floor(this.state.questions.length / 3) * 5;
  }

  selectOption(index) {
    if (this.state.selected !== null || this.state.discarded.has(index)) return;

    this.stopTimer();
    const question = this.currentQuestion();
    const isCorrect = index === question.correctIndex;
    const pointAward = isCorrect ? Math.max(this.state.timeLeft, 0) : 0;
    const consecutiveCorrect = isCorrect ? this.state.consecutiveCorrect + 1 : 0;
    const nextStreakProgress = isCorrect ? this.state.streakProgress + 1 : 0;
    const streakBonus = nextStreakProgress === 3 ? 5 : 0;
    const results = [...this.state.results];
    results[this.state.current] = isCorrect;

    this.setState({
      selected: index,
      score: this.state.score + pointAward + streakBonus,
      results,
      pointAward,
      streakProgress: nextStreakProgress,
      streakBonus,
      consecutiveCorrect,
      bestStreak: Math.max(this.state.bestStreak, consecutiveCorrect),
    });
  }

  discardOptions() {
    const { usedHelp, selected, current, questionHelpUsed } = this.state;
    if (usedHelp >= 3 || selected !== null || questionHelpUsed.has(current)) return;

    const question = this.currentQuestion();
    const removable = question.options
      .map((_, index) => index)
      .filter((index) => index !== question.correctIndex && !this.state.discarded.has(index));

    const shuffled = [...removable].sort(() => Math.random() - 0.5);
    const toDiscard = shuffled.slice(0, 2);
    const nextDiscarded = new Set(this.state.discarded);
    toDiscard.forEach((index) => nextDiscarded.add(index));

    const nextQuestionHelpUsed = new Set(questionHelpUsed);
    nextQuestionHelpUsed.add(current);

    this.setState({
      discarded: nextDiscarded,
      usedHelp: usedHelp + 1,
      questionHelpUsed: nextQuestionHelpUsed,
      animatedDiscarded: new Set(toDiscard),
    });
  }

  nextQuestion() {
    if (this.state.current >= this.state.questions.length - 1) {
      this.stopTimer();
      this.setState({ finished: true });
      this.dispatchEvent(
        new CustomEvent("trivia-finished", {
          detail: {
            score: this.state.score,
            total: this.maxPossibleScore(),
            totalQuestions: this.state.questions.length,
          },
          bubbles: true,
          composed: true,
        })
      );
      return;
    }

    this.setState({
      current: this.state.current + 1,
      selected: null,
      discarded: new Set(),
      transitionKey: this.state.transitionKey + 1,
      timeLeft: 15,
      animateQuestion: true,
      pointAward: 0,
      animatedDiscarded: new Set(),
      streakProgress: this.state.streakProgress >= 3 ? 0 : this.state.streakProgress,
      streakBonus: 0,
    });
    this.startTimer();
  }

  restart() {
    this.stopTimer();
    this.setState({
      current: 0,
      selected: null,
      discarded: new Set(),
      usedHelp: 0,
      score: 0,
      finished: false,
      questionHelpUsed: new Set(),
      transitionKey: this.state.transitionKey + 1,
      timeLeft: 15,
      results: Array(this.state.questions.length).fill(null),
      animateQuestion: false,
      pointAward: 0,
      animatedDiscarded: new Set(),
      streakProgress: 0,
      streakBonus: 0,
      consecutiveCorrect: 0,
      bestStreak: 0,
    });
    this.startTimer();
  }

  startTimer() {
    this.stopTimer();
    this.timerStartedAt = performance.now();
    this.state.timeLeft = 15;
    this.updateTimerUI(1, 15);

    const tick = (now) => {
      if (this.state.loading || this.state.finished || this.state.selected !== null) {
        this.stopTimer();
        return;
      }

      const elapsed = now - this.timerStartedAt;
      const remainingMs = Math.max(this.timerDuration - elapsed, 0);
      const ratio = remainingMs / this.timerDuration;
      const secondsLeft = Math.ceil(remainingMs / 1000);

      this.state.timeLeft = secondsLeft;
      this.updateTimerUI(ratio, secondsLeft);

      if (remainingMs <= 0) {
        this.handleTimeout();
        return;
      }

      this.timerId = window.requestAnimationFrame(tick);
    };

    this.timerId = window.requestAnimationFrame(tick);
  }

  stopTimer() {
    if (this.timerId) {
      window.cancelAnimationFrame(this.timerId);
      this.timerId = null;
    }
  }

  handleTimeout() {
    this.stopTimer();
    const results = [...this.state.results];
    results[this.state.current] = "timeout";
    this.setState({
      selected: -1,
      timeLeft: 0,
      results,
      pointAward: 0,
      streakProgress: 0,
      streakBonus: 0,
      consecutiveCorrect: 0,
    });
  }

  updateTimerUI(ratio = Math.max(this.state.timeLeft, 0) / 15, secondsLeft = this.state.timeLeft) {
    const timeRatio = Math.max(Math.min(ratio, 1), 0);
    const timeAngle = `${timeRatio * 360}deg`;
    const timer = this.shadowRoot.querySelector("[data-timer]");
    const number = this.shadowRoot.querySelector("[data-time-number]");
    const ring = this.shadowRoot.querySelector("[data-time-ring]");
    const bars = this.shadowRoot.querySelectorAll("[data-time-bar]");

    timer?.setAttribute("aria-label", `Tiempo restante: ${secondsLeft} segundos`);
    timer?.classList.toggle("is-ending", secondsLeft <= 5);
    if (number) number.textContent = secondsLeft;
    if (ring) ring.style.setProperty("--time-angle", timeAngle);
    bars.forEach((bar) => {
      bar.style.transform = `scaleX(${timeRatio})`;
    });
  }

  optionClass(index) {
    const { selected, discarded } = this.state;
    const question = this.currentQuestion();
    const classes = ["trivia-option"];

    if (discarded.has(index)) classes.push("is-discarded");
    if (this.state.animatedDiscarded.has(index)) classes.push("is-new-discard");

    if (selected !== null) {
      if (index === question.correctIndex) classes.push("is-correct");
      if (index === selected && index !== question.correctIndex) classes.push("is-wrong");
    }

    return classes.join(" ");
  }

  resultIcon(index, answered, question) {
    if (!answered) return `<span class="trivia-result-slot" aria-hidden="true"></span>`;

    if (index === question.correctIndex) {
      return `
        <span
          class="trivia-result-icon is-check"
          aria-label="Respuesta correcta"
          style="--icon-url: url('${this.iconUrl("circle-check-solid-full.svg")}')"
        ></span>
      `;
    }

    if (index === this.state.selected) {
      return `
        <span
          class="trivia-result-icon is-x"
          aria-label="Respuesta incorrecta"
          style="--icon-url: url('${this.iconUrl("circle-xmark-sharp-solid-full.svg")}')"
        ></span>
      `;
    }

    return `<span class="trivia-result-slot" aria-hidden="true"></span>`;
  }

  pointBubble(index, answered, question) {
    if (!answered || index !== question.correctIndex || this.state.selected !== index || this.state.pointAward <= 0) {
      return "";
    }

    return `<span class="trivia-point-bubble" aria-label="Puntos obtenidos">+${this.state.pointAward}</span>`;
  }

  streakSegments() {
    const segments = [
      "M 17 52 A 38 38 0 0 1 29 31",
      "M 42 17 A 38 38 0 0 1 58 17",
      "M 71 31 A 38 38 0 0 1 83 52",
    ];

    return segments
      .map((path, index) => `<path d="${path}" class="${this.state.streakProgress > index ? "is-filled" : ""}"></path>`)
      .join("");
  }

  iconUrl(fileName) {
    return new URL(`img/${fileName}`, TRIVIA_WIDGET_ASSET_BASE).href;
  }

  progressSteps() {
    return this.state.questions
      .map((_, index) => {
        const result = this.state.results[index];
        const isCurrent = index === this.state.current && result === null;
        const label = `Pregunta ${index + 1}`;

        if (result === true) {
          return `
            <span class="trivia-progress-step is-correct" role="listitem" aria-label="${label}: correcta">
              <span
                class="trivia-progress-icon"
                style="--icon-url: url('${this.iconUrl("circle-check-solid-full.svg")}')"
              ></span>
            </span>
          `;
        }

        if (result === false) {
          return `
            <span class="trivia-progress-step is-wrong" role="listitem" aria-label="${label}: incorrecta">
              <span
                class="trivia-progress-icon"
                style="--icon-url: url('${this.iconUrl("circle-xmark-sharp-solid-full.svg")}')"
              ></span>
            </span>
          `;
        }

        if (result === "timeout") {
          return `
            <span class="trivia-progress-step is-timeout" role="listitem" aria-label="${label}: tiempo agotado">
              <span
                class="trivia-progress-icon"
                style="--icon-url: url('${this.iconUrl("circle-exclamation-solid-full.svg")}')"
              ></span>
            </span>
          `;
        }

        return `
          <span class="trivia-progress-step ${isCurrent ? "is-current" : "is-pending"}" role="listitem" aria-label="${label}${
            isCurrent ? ": en curso" : ": pendiente"
          }">${isCurrent ? index + 1 : ""}</span>
        `;
      })
      .join("");
  }

  render() {
    if (!this.shadowRoot) return;

    this.shadowRoot.innerHTML = `
      <style>${this.styles()}</style>
      ${this.template()}
    `;

    this.bindEvents();

    if (this.state.animateQuestion) {
      this.state.animateQuestion = false;
    }

    if (this.state.animatedDiscarded.size) {
      this.state.animatedDiscarded = new Set();
    }
  }

  bindEvents() {
    this.shadowRoot.querySelectorAll("[data-option]").forEach((button) => {
      button.addEventListener("click", () => this.selectOption(Number(button.dataset.option)));
    });

    this.shadowRoot.querySelector("[data-help]")?.addEventListener("click", () => this.discardOptions());
    this.shadowRoot.querySelector("[data-next]")?.addEventListener("click", () => this.nextQuestion());
    this.shadowRoot.querySelector("[data-restart]")?.addEventListener("click", () => this.restart());
  }

  template() {
    if (this.state.loading) {
      return `<section class="trivia-shell" aria-live="polite"><div class="trivia-loading">Cargando trivia...</div></section>`;
    }

    if (this.state.error) {
      return `
        <section class="trivia-shell" aria-live="polite">
          <div class="trivia-error">
            <strong>No se pudo cargar la trivia</strong>
            <span>${this.escapeHtml(this.state.error)}</span>
          </div>
        </section>
      `;
    }

    if (this.state.finished) {
      const total = this.maxPossibleScore();
      const percentage = Math.round((this.state.score / total) * 100);
      return `
        <section class="trivia-shell trivia-results" aria-live="polite">
          <div class="trivia-kicker">Resultado final</div>
          <h2>${this.escapeHtml(this.state.title)}</h2>
          <div class="trivia-score">${this.state.score}<span> / ${total} pts</span></div>
          <p>Completaste la trivia con ${percentage}% de los puntos posibles. Mejor racha: ${this.state.bestStreak}.</p>
          <button class="trivia-primary" type="button" data-restart>Jugar de nuevo</button>
        </section>
      `;
    }

    const question = this.currentQuestion();
    const currentNumber = this.state.current + 1;
    const total = this.state.questions.length;
    const answered = this.state.selected !== null;
    const timeRatio = Math.max(this.state.timeLeft, 0) / 15;
    const timeAngle = `${timeRatio * 360}deg`;
    const helpUsedThisQuestion = this.state.questionHelpUsed.has(this.state.current);
    const helpDisabled = this.state.usedHelp >= 3 || answered || helpUsedThisQuestion;
    const helpUses = [0, 1, 2]
      .map((index) => `<span class="${index < this.state.usedHelp ? "is-used" : ""}"></span>`)
      .join("");

    return `
      <section class="trivia-shell" aria-live="polite">
        <div class="trivia-timer" data-timer aria-label="Tiempo restante: ${this.state.timeLeft} segundos">
          <span class="trivia-time-track trivia-time-track-left">
            <span class="trivia-time-bar trivia-time-bar-left" data-time-bar style="transform: scaleX(${timeRatio})"></span>
          </span>
          <span class="trivia-time-wrap">
            <svg class="trivia-streak-meter" viewBox="0 0 100 100" aria-label="Racha: ${Math.min(this.state.streakProgress, 3)} de 3">
              ${this.streakSegments()}
            </svg>
            <span class="trivia-time-ring" data-time-ring style="--time-angle: ${timeAngle}">
              <span data-time-number>${this.state.timeLeft}</span>
            </span>
            ${
              this.state.streakBonus
                ? `<span class="trivia-streak-toast">Racha alcanzada <strong>+${this.state.streakBonus}</strong></span>`
                : ""
            }
          </span>
          <span class="trivia-time-track trivia-time-track-right">
            <span class="trivia-time-bar trivia-time-bar-right" data-time-bar style="transform: scaleX(${timeRatio})"></span>
          </span>
        </div>

        <div class="trivia-live-score" aria-label="Puntaje en vivo">
          <span>Puntos</span>
          <strong>${this.state.score}</strong>
        </div>

        <article class="trivia-question ${this.state.animateQuestion ? "is-entering" : ""}" data-transition="${this.state.transitionKey}">
          <div class="trivia-prompt">
            ${
              answered
                ? `
                  <div class="trivia-explanation ${
                    this.state.selected === question.correctIndex ? "is-correct" : "is-wrong"
                  }">
                    <strong>${
                      this.state.selected === question.correctIndex
                        ? "Respuesta correcta."
                        : this.state.selected === -1
                          ? "Tiempo agotado."
                        : "Respuesta incorrecta."
                    }</strong>
                    <span>${this.escapeHtml(question.explanation)}</span>
                  </div>
                `
                : `<h2>${this.escapeHtml(question.question)}</h2>`
            }
          </div>

          <div class="trivia-options">
            ${question.options
              .map(
                (option, index) => `
                  <button
                    class="${this.optionClass(index)}"
                    type="button"
                    data-option="${index}"
                    ${answered || this.state.discarded.has(index) ? "disabled" : ""}
                  >
                    <span class="trivia-letter">${index + 1}</span>
                    <span class="trivia-option-text">${this.escapeHtml(option)}</span>
                    ${this.resultIcon(index, answered, question)}
                    ${this.pointBubble(index, answered, question)}
                  </button>
                `
              )
              .join("")}
          </div>
        </article>

        <div class="trivia-actions">
          <button
            class="trivia-ghost ${this.state.usedHelp >= 3 || helpUsedThisQuestion ? "is-empty" : ""}"
            type="button"
            data-help
            ${helpDisabled ? "disabled" : ""}
          >
            Descartar opciones
            <span class="trivia-help-dots" aria-label="${3 - this.state.usedHelp} usos disponibles">${helpUses}</span>
          </button>
          <button
            class="trivia-primary"
            type="button"
            data-next
            ${answered ? "" : "disabled"}
          >
            ${currentNumber === total ? "Ver resultado" : "Siguiente"}
          </button>
        </div>
      </section>
      <div class="trivia-progress-wrap">
        <div class="trivia-progress" role="list" aria-label="Avance de la trivia" style="--progress-count: ${total}">
          ${this.progressSteps()}
        </div>
        <div class="trivia-progress-label">Progreso</div>
      </div>
    `;
  }

  escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  styles() {
    return `
      @import url("https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap");

      @property --time-angle {
        syntax: "<angle>";
        inherits: false;
        initial-value: 360deg;
      }

      :host {
        display: block;
        color: #213034;
        font-family: "Montserrat", "Segoe UI", sans-serif;
        line-height: 1.45;
        margin-inline: auto;
        max-width: 600px;
      }

      :host *,
      :host *::before,
      :host *::after {
        box-sizing: border-box;
      }

      .trivia-shell {
        background:
          linear-gradient(135deg, #ffffff, #f4f6f6),
          linear-gradient(90deg, rgba(33, 48, 52, 0.05), rgba(136, 148, 151, 0.1));
        border: 2px solid rgba(33, 48, 52, 0.1);
        border-radius: 8px;
        box-shadow: 0 18px 48px rgba(56, 81, 76, 0.12);
        overflow: hidden;
        padding: clamp(20px, 4vw, 32px);
        position: relative;
      }

      .trivia-kicker {
        color: #2f7f68;
        font-size: 0.78rem;
        font-weight: 800;
        letter-spacing: 0;
        text-transform: uppercase;
      }

      .trivia-score span {
        color: #6a7779;
        font-size: 0.9rem;
        font-weight: 700;
      }

      .trivia-progress {
        align-items: center;
        display: grid;
        gap: 8px;
        grid-template-columns: repeat(var(--progress-count, 10), 1fr);
        position: relative;
      }

      .trivia-progress-wrap {
        margin-inline: auto;
        margin-top: 28px;
        padding: 0 10px;
        width: 80%;
      }

      .trivia-progress::before {
        background: #e7eaea;
        border-radius: 999px;
        content: "";
        height: 5px;
        left: 12px;
        position: absolute;
        right: 12px;
        top: 50%;
        transform: translateY(-50%);
      }

      .trivia-progress-step {
        align-items: center;
        background: #e7eaea;
        border: 3px solid #e7eaea;
        border-radius: 50%;
        color: transparent;
        display: inline-flex;
        font-size: 0.8rem;
        font-weight: 600;
        height: 26px;
        justify-content: center;
        justify-self: center;
        position: relative;
        width: 26px;
        z-index: 1;
      }

      .trivia-progress-step.is-current {
        background: #213034;
        border-color: #213034;
        box-shadow: none;
        color: #ffffff;
      }

      .trivia-progress-step.is-correct,
      .trivia-progress-step.is-wrong,
      .trivia-progress-step.is-timeout {
        background: #ffffff;
        border: 0;
        height: 30px;
        width: 30px;
      }

      .trivia-progress-step.is-correct {
        color: #30C1E2;
      }

      .trivia-progress-step.is-wrong {
        color: #ff5342;
      }

      .trivia-progress-step.is-timeout {
        color: #ff5342;
      }

      .trivia-progress-icon {
        background: currentColor;
        display: block;
        height: 30px;
        mask: var(--icon-url) center / contain no-repeat;
        -webkit-mask: var(--icon-url) center / contain no-repeat;
        width: 30px;
      }

      .trivia-progress-label {
        color: #7d898b;
        font-size: 0.78rem;
        font-weight: 700;
        margin-top: 8px;
        text-align: center;
      }

      .trivia-timer {
        align-items: center;
        display: grid;
        gap: 12px;
        grid-template-columns: minmax(42px, 1fr) 74px minmax(42px, 1fr);
        margin: 0 0 10px;
      }

      .trivia-time-track {
        background: rgba(33, 48, 52, 0.11);
        border-radius: 999px;
        display: block;
        height: 7px;
        overflow: hidden;
      }

      .trivia-time-bar {
        background: #7E7E7E;
        border-radius: inherit;
        display: block;
        height: 100%;
        opacity: 0.88;
        transition: transform 80ms linear, background 260ms ease;
        width: 100%;
      }

      .trivia-timer.is-ending .trivia-time-bar {
        background: #ff5342;
      }

      .trivia-time-bar-left {
        transform-origin: right center;
      }

      .trivia-time-bar-right {
        transform-origin: left center;
      }

      .trivia-time-ring {
        --timer-ring-color: #7E7E7E;
        align-items: center;
        aspect-ratio: 1;
        background:
          radial-gradient(circle, #ffffff 57%, transparent 58%),
          conic-gradient(var(--timer-ring-color) var(--time-angle), rgba(33, 48, 52, 0.11) 0);
        border-radius: 50%;
        color: #213034;
        display: inline-flex;
        font-size: 1.25rem;
        font-weight: 800;
        justify-content: center;
        position: relative;
        transition: --time-angle 80ms linear;
        width: 74px;
      }

      .trivia-time-wrap {
        display: inline-flex;
        position: relative;
      }

      .trivia-streak-meter {
        height: 98px;
        left: 50%;
        pointer-events: none;
        position: absolute;
        top: -12px;
        transform: translateX(-50%);
        width: 98px;
        z-index: 2;
      }

      .trivia-streak-meter path {
        fill: none;
        stroke: #dce1e2;
        stroke-linecap: round;
        stroke-width: 6;
        transition: stroke 260ms ease;
      }

      .trivia-streak-meter path.is-filled {
        stroke: #30C1E2;
      }

      .trivia-streak-toast {
        animation: triviaStreakToast 1200ms ease-out both;
        background: #213034;
        border-radius: 999px;
        color: #ffffff;
        font-size: 0.72rem;
        font-weight: 800;
        left: 50%;
        line-height: 1;
        padding: 7px 9px;
        pointer-events: none;
        position: absolute;
        top: calc(100% + 8px);
        transform: translateX(-50%);
        white-space: nowrap;
        z-index: 3;
      }

      .trivia-streak-toast strong {
        color: #30C1E2;
      }

      .trivia-time-ring::after {
        border: 1px solid rgba(33, 48, 52, 0.1);
        border-radius: inherit;
        content: "";
        inset: 0;
        position: absolute;
      }

      .trivia-time-ring span {
        position: relative;
      }

      .trivia-timer.is-ending .trivia-time-ring {
        --timer-ring-color: #ff5342;
      }

      .trivia-live-score {
        align-items: center;
        color: #4f5c5f;
        display: inline-flex;
        gap: 7px;
        justify-content: center;
        margin: 7px auto 2px;
        width: 100%;
      }

      .trivia-live-score span {
        font-size: 0.72rem;
        font-weight: 700;
      }

      .trivia-live-score strong {
        color: #213034;
        font-size: 0.92rem;
        font-weight: 800;
      }

      .trivia-prompt {
        align-items: center;
        display: flex;
        min-height: clamp(66px, 11vw, 92px);
      }

      .trivia-question.is-entering {
        animation: triviaSlide 340ms ease both;
      }

      .trivia-question h2,
      .trivia-results h2 {
        color: #213034;
        font-size: clamp(1.25rem, 2.4vw, 1.5rem);
        font-weight: 700;
        letter-spacing: 0;
        line-height: 1.16;
        margin: 0;
        text-align: center;
        width: 100%;
      }

      .trivia-options {
        display: grid;
        gap: 12px;
        margin-top: 18px;
      }

      .trivia-option {
        align-items: center;
        background: #f7f8f8;
        border: 1px solid rgba(33, 48, 52, 0.13);
        border-radius: 8px;
        color: #2f3c3f;
        cursor: pointer;
        display: grid;
        font: inherit;
        font-size: 1.125rem;
        font-weight: 700;
        gap: 13px;
        grid-template-columns: 36px 1fr 26px;
        min-height: 55px;
        padding: 9px 14px;
        position: relative;
        text-align: left;
        transition: transform 180ms ease, border-color 180ms ease, background 180ms ease, box-shadow 180ms ease, opacity 180ms ease;
        width: 100%;
      }

      .trivia-option:hover:not(:disabled),
      .trivia-option:focus-visible {
        background: transparent;
        border-color: rgba(33, 48, 52, 0.36);
        box-shadow: inset 0 0 0 1px rgba(33, 48, 52, 0.34), 0 10px 20px rgba(33, 48, 52, 0.07);
        outline: none;
        transform: translateY(-2px);
      }

      .trivia-letter {
        align-items: center;
        background: #e5e9e9;
        border-radius: 8px;
        color: #4f5c5f;
        display: inline-flex;
        font-weight: 800;
        height: 36px;
        justify-content: center;
        width: 36px;
      }

      .trivia-option-text {
        min-width: 0;
        overflow-wrap: anywhere;
        word-break: break-word;
      }

      .trivia-result-slot,
      .trivia-result-icon {
        display: block;
        height: 24px;
        justify-self: end;
        width: 24px;
      }

      .trivia-result-icon {
        background: currentColor;
        mask: var(--icon-url) center / contain no-repeat;
        -webkit-mask: var(--icon-url) center / contain no-repeat;
      }

      .trivia-result-icon.is-check {
        color: #30C1E2;
      }

      .trivia-result-icon.is-x {
        color: #ff5342;
      }

      .trivia-point-bubble {
        animation: triviaPointFloat 980ms ease-out both;
        background: #30C1E2;
        border-radius: 999px;
        box-shadow: 0 10px 22px rgba(48, 193, 226, 0.24);
        color: #ffffff;
        font-size: 0.9rem;
        font-weight: 800;
        line-height: 1;
        padding: 7px 10px;
        pointer-events: none;
        position: absolute;
        right: 44px;
        top: 50%;
        transform: translateY(-50%);
        z-index: 2;
      }

      .trivia-option:disabled {
        opacity: 1;
      }

      .trivia-option.is-correct {
        animation: triviaCorrect 520ms ease both;
        background: #eaf9fd;
        border-color: #30C1E2;
      }

      .trivia-option.is-correct .trivia-letter {
        background: #30C1E2;
        color: #ffffff;
      }

      .trivia-option.is-wrong {
        animation: triviaWrong 420ms ease both;
        background: #fff1ef;
        border-color: #ff5342;
      }

      .trivia-option.is-wrong .trivia-letter {
        background: #ff5342;
        color: #ffffff;
      }

      .trivia-option.is-discarded {
        background: #eef1f0;
        border-color: rgba(84, 100, 103, 0.18);
        opacity: 0.42;
        position: relative;
        transform-origin: center;
      }

      .trivia-option.is-new-discard {
        animation: triviaDiscardFlip 520ms ease both;
      }

      .trivia-option.is-discarded::after {
        background: #889497;
        content: "";
        height: 2px;
        left: 14px;
        position: absolute;
        right: 14px;
        top: 50%;
      }

      .trivia-actions {
        align-items: center;
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        justify-content: space-between;
        margin-top: 24px;
      }

      .trivia-primary,
      .trivia-ghost {
        align-items: center;
        border-radius: 8px;
        cursor: pointer;
        display: inline-flex;
        font: inherit;
        font-weight: 700;
        gap: 10px;
        justify-content: center;
        min-height: 48px;
        padding: 12px 18px;
        transition: transform 180ms ease, box-shadow 180ms ease, opacity 180ms ease, background 180ms ease;
      }

      .trivia-primary {
        background: #3EB8D4;
        border: 1px solid #3EB8D4;
        color: #ffffff;
        min-width: 150px;
      }

      .trivia-primary:hover:not(:disabled),
      .trivia-primary:focus-visible {
        background: #30A9C6;
        box-shadow: none;
        outline: none;
        transform: translateY(-2px);
      }

      .trivia-primary:disabled {
        background: #e2e6e7;
        border-color: #d3d9da;
        color: #8b9699;
      }

      .trivia-ghost {
        background: transparent;
        border: 1px solid #4f5c5f;
        color: #4f5c5f;
      }

      .trivia-ghost:hover:not(:disabled),
      .trivia-ghost:focus-visible {
        background: #7d898b;
        color: #ffffff;
        box-shadow: none;
        outline: none;
      }

      .trivia-ghost.is-empty {
        background: #eef1f0;
        border-color: rgba(84, 100, 103, 0.18);
        color: #7d898b;
      }

      .trivia-help-dots {
        align-items: center;
        display: inline-flex;
        gap: 5px;
      }

      .trivia-help-dots span {
        background: #4f5c5f;
        border-radius: 50%;
        display: block;
        height: 8px;
        transition: background 180ms ease, transform 180ms ease;
        width: 8px;
      }

      .trivia-help-dots span.is-used {
        background: #b9c1c3;
        transform: scale(0.86);
      }

      .trivia-ghost:hover:not(:disabled) .trivia-help-dots span:not(.is-used),
      .trivia-ghost:focus-visible .trivia-help-dots span:not(.is-used) {
        background: #ffffff;
      }

      button:disabled:not(.trivia-option) {
        cursor: not-allowed;
      }

      .trivia-option:disabled {
        cursor: not-allowed;
      }

      .trivia-explanation {
        animation: triviaSwap 320ms ease both;
        background: #eaf9fd;
        border: 1px solid rgba(48, 193, 226, 0.28);
        border-radius: 8px;
        padding: 16px 18px;
        width: 100%;
      }

      .trivia-explanation.is-wrong {
        background: #fff1ef;
        border-color: rgba(255, 83, 66, 0.28);
      }

      .trivia-explanation strong,
      .trivia-explanation span {
        display: block;
      }

      .trivia-explanation strong {
        color: #30C1E2;
        font-weight: 800;
        margin-bottom: 4px;
      }

      .trivia-explanation.is-wrong strong {
        color: #ff5342;
      }

      .trivia-explanation span,
      .trivia-results p,
      .trivia-error span {
        color: #546467;
      }

      .trivia-results {
        text-align: center;
      }

      .trivia-score {
        color: #2f7f68;
        font-size: clamp(3.4rem, 12vw, 6rem);
        font-weight: 800;
        line-height: 1;
        margin: 20px 0 10px;
      }

      .trivia-results .trivia-primary {
        margin-top: 14px;
      }

      .trivia-loading,
      .trivia-error {
        background: rgba(255, 255, 255, 0.78);
        border-radius: 8px;
        padding: 18px;
      }

      .trivia-error strong {
        display: block;
        margin-bottom: 6px;
      }

      @keyframes triviaSlide {
        from {
          opacity: 0;
          transform: translateX(18px);
        }
        to {
          opacity: 1;
          transform: translateX(0);
        }
      }

      @keyframes triviaReveal {
        from {
          opacity: 0;
          transform: translateY(8px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      @keyframes triviaSwap {
        from {
          opacity: 0;
          transform: translateY(10px) scale(0.985);
        }
        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }

      @keyframes triviaCorrect {
        0%, 100% {
          transform: scale(1);
        }
        45% {
          transform: scale(1.018);
        }
      }

      @keyframes triviaWrong {
        0%, 100% {
          transform: translateX(0);
        }
        25% {
          transform: translateX(-7px);
        }
        55% {
          transform: translateX(7px);
        }
      }

      @keyframes triviaDiscardFlip {
        0% {
          opacity: 1;
          transform: rotateX(0);
        }
        48% {
          opacity: 0.72;
          transform: rotateX(82deg);
        }
        100% {
          opacity: 0.42;
          transform: rotateX(0);
        }
      }

      @keyframes triviaStreakToast {
        0% {
          opacity: 0;
          transform: translate(-50%, 6px) scale(0.92);
        }
        18% {
          opacity: 1;
          transform: translate(-50%, 0) scale(1);
        }
        72% {
          opacity: 1;
          transform: translate(-50%, 0) scale(1);
        }
        100% {
          opacity: 0;
          transform: translate(-50%, -14px) scale(0.96);
        }
      }

      @keyframes triviaPointFloat {
        0% {
          opacity: 0;
          transform: translateY(-50%) scale(0.88);
        }
        18% {
          opacity: 1;
          transform: translateY(-82%) scale(1);
        }
        70% {
          opacity: 1;
          transform: translateY(-128%) scale(1);
        }
        100% {
          opacity: 0;
          transform: translateY(-178%) scale(0.96);
        }
      }

      @media (max-width: 560px) {
        .trivia-actions {
          align-items: stretch;
          flex-direction: column;
        }

        .trivia-primary,
        .trivia-ghost {
          width: 100%;
        }

        .trivia-timer {
          grid-template-columns: minmax(28px, 1fr) 64px minmax(28px, 1fr);
          gap: 9px;
        }

        .trivia-time-ring {
          font-size: 1.05rem;
          width: 64px;
        }

        .trivia-streak-meter {
          height: 86px;
          top: -11px;
          width: 86px;
        }

        .trivia-streak-meter path {
          stroke-width: 5;
        }

        .trivia-progress-wrap {
          margin-inline: 0;
          margin-top: 24px;
          padding: 0 4px;
          width: 100%;
        }

        .trivia-progress {
          gap: 3px;
        }

        .trivia-progress::before {
          height: 4px;
          left: 8px;
          right: 8px;
        }

        .trivia-progress-step {
          border-width: 2px;
          height: 18px;
          width: 18px;
        }

        .trivia-progress-step.is-current {
          box-shadow: none;
        }

        .trivia-progress-step.is-correct,
        .trivia-progress-step.is-wrong,
        .trivia-progress-step.is-timeout,
        .trivia-progress-icon {
          height: 20px;
          width: 20px;
        }
      }
    `;
  }
}

if (!customElements.get("trivia-widget")) {
  customElements.define("trivia-widget", TriviaWidget);
}
