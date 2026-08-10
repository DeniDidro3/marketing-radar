let DATA = null;

const fmt =
  new Intl.NumberFormat("ru-RU");

const money = (v) =>
  `${fmt.format(
    Math.round(Number(v || 0))
  )} ₽`;

const number = (v) =>
  fmt.format(
    Math.round(Number(v || 0))
  );

const pct = (v) =>
  `${Number(v || 0).toFixed(2)}%`;


/* =========================================================
   CRYPTO
========================================================= */

function base64ToBytes(base64) {
  const binary = atob(base64);

  const bytes =
    new Uint8Array(
      binary.length
    );

  for (
    let i = 0;
    i < binary.length;
    i++
  ) {
    bytes[i] =
      binary.charCodeAt(i);
  }

  return bytes;
}


async function deriveKey(
  password,
  salt,
  iterations
) {
  const encoder =
    new TextEncoder();

  const keyMaterial =
    await crypto.subtle.importKey(
      "raw",
      encoder.encode(password),
      "PBKDF2",
      false,
      ["deriveKey"]
    );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: "SHA-256",
    },

    keyMaterial,

    {
      name: "AES-GCM",
      length: 256,
    },

    false,

    ["decrypt"]
  );
}


async function decryptPayload(
  payload,
  password
) {
  const salt =
    base64ToBytes(
      payload.salt
    );

  const nonce =
    base64ToBytes(
      payload.nonce
    );

  const ciphertext =
    base64ToBytes(
      payload.ciphertext
    );

  const key =
    await deriveKey(
      password,
      salt,
      payload.iterations
    );

  const plaintext =
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: nonce,
      },
      key,
      ciphertext
    );

  return JSON.parse(
    new TextDecoder().decode(
      plaintext
    )
  );
}


async function loadEncryptedReport(
  password
) {
  const response =
    await fetch(
      `data/report.enc?t=${Date.now()}`
    );

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status}`
    );
  }

  const payload =
    await response.json();

  return decryptPayload(
    payload,
    password
  );
}


/* =========================================================
   LOGIN
========================================================= */

function showLogin() {
  document.body.insertAdjacentHTML(
    "beforeend",
    `
    <div
      id="loginOverlay"
      style="
        position:fixed;
        inset:0;
        z-index:99999;
        background:#07111f;
        display:flex;
        align-items:center;
        justify-content:center;
        padding:24px;
      "
    >
      <div style="
        width:100%;
        max-width:400px;
        padding:32px;
        border:1px solid #20354e;
        border-radius:18px;
        background:#0e1c2e;
      ">

        <div style="
          font-size:11px;
          letter-spacing:.12em;
          color:#5aa7ff;
          margin-bottom:10px;
        ">
          MARKETING RADAR
        </div>

        <h2 style="
          margin:0 0 8px;
        ">
          Доступ к аналитике
        </h2>

        <p style="
          color:#8ea2bb;
          font-size:13px;
          line-height:1.5;
        ">
          Введите пароль для
          расшифровки рекламных данных.
        </p>

        <input
          id="reportPassword"
          type="password"
          placeholder="Пароль"
          style="
            width:100%;
            padding:13px;
            border-radius:9px;
            border:1px solid #20354e;
            background:#091525;
            color:white;
            margin-top:12px;
          "
        >

        <div
          id="loginError"
          style="
            color:#ff6b72;
            font-size:11px;
            min-height:18px;
            margin-top:8px;
          "
        ></div>

        <button
          id="loginButton"
          style="
            width:100%;
            padding:13px;
            margin-top:8px;
            border:0;
            border-radius:9px;
            background:#3e9df8;
            color:white;
            font-weight:600;
            cursor:pointer;
          "
        >
          Войти
        </button>

      </div>
    </div>
    `
  );

  const input =
    document.getElementById(
      "reportPassword"
    );

  const button =
    document.getElementById(
      "loginButton"
    );

  async function login() {
    const password =
      input.value;

    if (!password) {
      return;
    }

    button.disabled = true;

    button.textContent =
      "Расшифровка...";

    try {
      DATA =
        await loadEncryptedReport(
          password
        );

      sessionStorage.setItem(
        "marketingRadarPassword",
        password
      );

      document
        .getElementById(
          "loginOverlay"
        )
        .remove();

      render();

    } catch (error) {

      console.error(error);

      document
        .getElementById(
          "loginError"
        )
        .textContent =
          "Неверный пароль.";

      button.disabled = false;

      button.textContent =
        "Войти";
    }
  }

  button.addEventListener(
    "click",
    login
  );

  input.addEventListener(
    "keydown",
    event => {
      if (
        event.key === "Enter"
      ) {
        login();
      }
    }
  );

  input.focus();
}


async function start() {
  const password =
    sessionStorage.getItem(
      "marketingRadarPassword"
    );

  if (password) {
    try {
      DATA =
        await loadEncryptedReport(
          password
        );

      render();

      return;

    } catch {
      sessionStorage.removeItem(
        "marketingRadarPassword"
      );
    }
  }

  showLogin();
}


/* =========================================================
   MAIN RENDER
========================================================= */

function render() {
  renderMeta();
  renderHero();
  renderKPIs();
  renderCampaignTable();
  renderDirectSummary();
  renderCreativeSummary();
  renderCreatives();
}


/* =========================================================
   META
========================================================= */

function renderMeta() {
  const updated =
    formatDate(
      DATA.meta?.updated_at
    );

  const sidebar =
    document.getElementById(
      "sidebarUpdated"
    );

  const footer =
    document.getElementById(
      "footerUpdated"
    );

  if (sidebar) {
    sidebar.textContent =
      updated;
  }

  if (footer) {
    footer.textContent =
      `Обновлено ${updated}`;
  }

  const badge =
    document.getElementById(
      "navAlertCount"
    );

  if (badge) {
    badge.textContent = "—";
  }
}


/* =========================================================
   HERO
========================================================= */

function renderHero() {
  const s =
    DATA.summary || {};

  document.getElementById(
    "heroHeadline"
  ).textContent =
    "Данные Яндекс Директа обновлены";

  document.getElementById(
    "heroCopy"
  ).textContent =
    `${DATA.campaigns?.length || 0} кампаний, ` +
    `${number(s.clicks)} кликов, ` +
    `${money(s.spend)} расходов`;

  document.getElementById(
    "healthScore"
  ).textContent =
    "LIVE";
}


/* =========================================================
   KPI
========================================================= */

function renderKPIs() {
  const s =
    DATA.summary || {};

  const items = [
    [
      "Расход",
      money(s.spend)
    ],

    [
      "Показы",
      number(
        s.impressions
      )
    ],

    [
      "Клики",
      number(
        s.clicks
      )
    ],

    [
      "CTR",
      pct(s.ctr)
    ],
  ];

  document.getElementById(
    "kpis"
  ).innerHTML =
    items.map(
      ([label, value]) => `
        <div class="kpi">

          <div class="label">
            ${label}
          </div>

          <div class="value">
            ${value}
          </div>

          <div class="delta neutral">
            за выбранный период
          </div>

        </div>
      `
    ).join("");
}


/* =========================================================
   CAMPAIGNS
========================================================= */

function renderCampaignTable() {
  const campaigns =
    [...(
      DATA.campaigns || []
    )];

  campaigns.sort(
    (a, b) =>
      b.spend - a.spend
  );

  document.getElementById(
    "campaignTable"
  ).innerHTML = `
    <table class="table">

      <thead>
        <tr>
          <th>Кампания</th>
          <th>Расход</th>
          <th>Показы</th>
          <th>Клики</th>
          <th>CTR</th>
          <th>CPC</th>
        </tr>
      </thead>

      <tbody>

        ${
          campaigns.map(
            c => `
              <tr>

                <td>
                  ${escapeHtml(
                    c.name
                  )}
                </td>

                <td>
                  ${money(
                    c.spend
                  )}
                </td>

                <td>
                  ${number(
                    c.impressions
                  )}
                </td>

                <td>
                  ${number(
                    c.clicks
                  )}
                </td>

                <td>
                  ${pct(
                    c.ctr
                  )}
                </td>

                <td>
                  ${money(
                    c.avg_cpc
                  )}
                </td>

              </tr>
            `
          ).join("")
        }

      </tbody>

    </table>
  `;
}


/* =========================================================
   DIRECT SUMMARY
========================================================= */

function renderDirectSummary() {
  const campaigns =
    [...(
      DATA.campaigns || []
    )];

  const highestSpend =
    campaigns
      .slice()
      .sort(
        (a, b) =>
          b.spend - a.spend
      )[0];

  const bestCtr =
    campaigns
      .slice()
      .sort(
        (a, b) =>
          b.ctr - a.ctr
      )[0];

  const container =
    document.getElementById(
      "budgetPreview"
    );

  container.innerHTML = `
    <div class="budget-item">

      <div>
        <strong>
          Средний CPC
        </strong>

        <small>
          По всем кампаниям
        </small>
      </div>

      <strong>
        ${money(
          DATA.summary.avg_cpc
        )}
      </strong>

    </div>

    ${
      highestSpend
        ? `
          <div class="budget-item">

            <div>
              <strong>
                Максимальный расход
              </strong>

              <small>
                ${escapeHtml(
                  highestSpend.name
                )}
              </small>
            </div>

            <strong>
              ${money(
                highestSpend.spend
              )}
            </strong>

          </div>
        `
        : ""
    }

    ${
      bestCtr
        ? `
          <div class="budget-item">

            <div>
              <strong>
                Лучший CTR
              </strong>

              <small>
                ${escapeHtml(
                  bestCtr.name
                )}
              </small>
            </div>

            <strong>
              ${pct(
                bestCtr.ctr
              )}
            </strong>

          </div>
        `
        : ""
    }
  `;
}


/* =========================================================
   CREATIVE SUMMARY
========================================================= */

function renderCreativeSummary() {
  const s =
    DATA.creative_summary;

  if (!s) {
    return;
  }

  const priority =
    document.getElementById(
      "priorityAlerts"
    );

  if (!priority) {
    return;
  }

  priority.innerHTML = `

    <article
      class="alert-card opportunity"
    >
      <div class="severity">
        Успешные
      </div>

      <h4>
        ${s.successful}
        эффективных объявлений
      </h4>

      <p>
        Score 70+ относительно
        сопоставимых объявлений.
      </p>
    </article>


    <article
      class="alert-card warning"
    >
      <div class="severity">
        Выгорание
      </div>

      <h4>
        ${s.fatigue}
        объявлений выгорают
      </h4>

      <p>
        CTR падает одновременно
        с ростом CPC.
      </p>
    </article>


    <article
      class="alert-card critical"
    >
      <div class="severity">
        Слабые
      </div>

      <h4>
        ${s.weak}
        слабых объявлений
      </h4>

      <p>
        Score ниже 45.
      </p>
    </article>

  `;
}


/* =========================================================
   CREATIVES
========================================================= */

function renderCreatives() {
  const container =
    document.getElementById(
      "creativeGrid"
    );

  if (!container) {
    return;
  }

  const creatives =
    DATA.creatives || [];

  if (!creatives.length) {
    container.innerHTML =
      `<div class="note">
        Объявления не найдены.
      </div>`;

    return;
  }

  container.innerHTML =
    creatives.map(
      creativeCard
    ).join("");
}


function creativeCard(c) {
  const status =
    creativeStatus(
      c.status
    );

  const score =
    c.score === null
      ? "—"
      : c.score;

  const trend =
    c.trend || {};

  return `
    <article class="creative">

      <div class="creative-head">

        <div>
          <div
            style="
              font-size:10px;
              color:#8ea2bb;
              margin-bottom:5px;
            "
          >
            AD ${escapeHtml(
              c.ad_id
            )}
          </div>

          <h4>
            ${escapeHtml(
              c.campaign_name
            )}
          </h4>
        </div>

        <span
          class="fatigue"
          title="Traffic Efficiency Score"
        >
          ${score}
        </span>

      </div>


      <div
        style="
          margin-top:8px;
          font-size:11px;
          color:#8ea2bb;
        "
      >
        ${escapeHtml(
          c.ad_group_name
        )}
      </div>


      <div
        style="
          display:flex;
          gap:6px;
          flex-wrap:wrap;
          margin-top:12px;
        "
      >

        <span
          style="
            padding:5px 8px;
            border-radius:7px;
            background:#0a1726;
            font-size:10px;
          "
        >
          ${status.icon}
          ${status.label}
        </span>

        <span
          style="
            padding:5px 8px;
            border-radius:7px;
            background:#0a1726;
            font-size:10px;
          "
        >
          ${escapeHtml(
            c.network
          )}
        </span>

        <span
          style="
            padding:5px 8px;
            border-radius:7px;
            background:#0a1726;
            font-size:10px;
          "
        >
          ${escapeHtml(
            c.format
          )}
        </span>

      </div>


      <div class="stats"
        style="
          margin-top:15px;
        "
      >

        <div class="mini">
          <span>CTR</span>

          <strong>
            ${pct(c.ctr)}
          </strong>
        </div>


        <div class="mini">
          <span>CPC</span>

          <strong>
            ${money(
              c.avg_cpc
            )}
          </strong>
        </div>


        <div class="mini">
          <span>Клики</span>

          <strong>
            ${number(
              c.clicks
            )}
          </strong>
        </div>


        <div class="mini">
          <span>Расход</span>

          <strong>
            ${money(
              c.spend
            )}
          </strong>
        </div>

      </div>


      <div
        style="
          margin-top:15px;
          padding-top:13px;
          border-top:1px solid #20354e;
        "
      >

        <div
          style="
            display:flex;
            justify-content:space-between;
            font-size:11px;
          "
        >
          <span
            style="color:#8ea2bb"
          >
            CTR 7 дней
          </span>

          <strong>
            ${signedPercent(
              trend.ctr_change
            )}
          </strong>
        </div>


        <div
          style="
            display:flex;
            justify-content:space-between;
            margin-top:7px;
            font-size:11px;
          "
        >
          <span
            style="color:#8ea2bb"
          >
            CPC 7 дней
          </span>

          <strong>
            ${signedPercent(
              trend.cpc_change
            )}
          </strong>
        </div>

      </div>


      <p>
        ${escapeHtml(
          c.reason
        )}
      </p>

    </article>
  `;
}


function creativeStatus(status) {
  const statuses = {
    successful: {
      icon: "🟢",
      label: "Успешный",
    },

    normal: {
      icon: "🟡",
      label: "Нормальный",
    },

    weak: {
      icon: "🔴",
      label: "Слабый",
    },

    fatigue: {
      icon: "🔥",
      label: "Выгорает",
    },

    improving: {
      icon: "🚀",
      label: "Улучшается",
    },

    insufficient_data: {
      icon: "⚪",
      label: "Мало данных",
    },
  };

  return (
    statuses[status]
    || statuses.normal
  );
}


function signedPercent(value) {
  value =
    Number(value || 0);

  const prefix =
    value > 0
      ? "+"
      : "";

  return (
    prefix
    + value.toFixed(1)
    + "%"
  );
}


/* =========================================================
   NAVIGATION
========================================================= */

document
  .querySelectorAll(".nav")
  .forEach(
    button => {

      button.addEventListener(
        "click",
        () => {

          showSection(
            button.dataset.section
          );

        }
      );

    }
  );


document
  .querySelectorAll(
    "[data-goto]"
  )
  .forEach(
    button => {

      button.addEventListener(
        "click",
        () => {

          showSection(
            button.dataset.goto
          );

        }
      );

    }
  );


function showSection(id) {
  document
    .querySelectorAll(
      ".section"
    )
    .forEach(
      section =>
        section.classList.remove(
          "active"
        )
    );

  document
    .querySelectorAll(
      ".nav"
    )
    .forEach(
      button =>
        button.classList.toggle(
          "active",
          button.dataset.section
            === id
        )
    );

  const target =
    document.getElementById(id);

  if (target) {
    target.classList.add(
      "active"
    );
  }

  const titles = {
    overview: [
      "Обзор рекламы",
      "Актуальные показатели Яндекс Директа."
    ],

    alerts: [
      "Аномалии",
      "Автоматический контроль отклонений."
    ],

    budget: [
      "Budget Optimizer",
      "Анализ эффективности расходов."
    ],

    creatives: [
      "Creative Intelligence",
      "Какие объявления работают, а какие теряют эффективность."
    ],
  };

  if (titles[id]) {
    document.getElementById(
      "pageTitle"
    ).textContent =
      titles[id][0];

    document.getElementById(
      "pageSubtitle"
    ).textContent =
      titles[id][1];
  }
}


/* =========================================================
   UTILITIES
========================================================= */

function formatDate(value) {
  if (!value) {
    return "—";
  }

  return new Date(
    value
  ).toLocaleString(
    "ru-RU"
  );
}


function escapeHtml(value) {
  return String(
    value ?? ""
  )
    .replaceAll(
      "&",
      "&amp;"
    )
    .replaceAll(
      "<",
      "&lt;"
    )
    .replaceAll(
      ">",
      "&gt;"
    )
    .replaceAll(
      '"',
      "&quot;"
    )
    .replaceAll(
      "'",
      "&#039;"
    );
}


/* =========================================================
   START
========================================================= */

start();
