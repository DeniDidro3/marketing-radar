let DATA = null;

const fmt =
  new Intl.NumberFormat("ru-RU");


const money = value =>
  `${fmt.format(
    Math.round(
      Number(value || 0)
    )
  )} ₽`;


const number = value =>
  fmt.format(
    Math.round(
      Number(value || 0)
    )
  );


const pct = value =>
  `${Number(
    value || 0
  ).toFixed(2)}%`;


/* =========================================================
   CRYPTO
========================================================= */

function base64ToBytes(
  base64
) {

  const binary =
    atob(base64);

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

  const material =
    await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(
        password
      ),
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

    material,

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

      <div
        style="
          width:100%;
          max-width:400px;
          padding:32px;
          border:1px solid #20354e;
          border-radius:18px;
          background:#0e1c2e;
        "
      >

        <div
          style="
            font-size:11px;
            letter-spacing:.12em;
            color:#5aa7ff;
            margin-bottom:10px;
          "
        >
          MARKETING RADAR
        </div>

        <h2>
          Доступ к аналитике
        </h2>

        <p
          style="
            color:#8ea2bb;
            font-size:13px;
          "
        >
          Введите пароль
          для расшифровки данных.
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
            margin-top:10px;
          "
        >

        <div
          id="loginError"
          style="
            min-height:18px;
            color:#ff6b72;
            font-size:11px;
            margin-top:8px;
          "
        ></div>

        <button
          id="loginButton"
          style="
            width:100%;
            padding:13px;
            border:0;
            border-radius:9px;
            background:#3e9df8;
            color:white;
            font-weight:600;
            cursor:pointer;
            margin-top:8px;
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

  const creatives =
    DATA.creative_summary || {};

  document.getElementById(
    "heroHeadline"
  ).textContent =
    "Marketing Radar работает";

  document.getElementById(
    "heroCopy"
  ).textContent =
    `${number(
      creatives.total
    )} визуальных креативов · ` +
    `${money(
      s.spend
    )} расходов · ` +
    `${number(
      s.clicks
    )} кликов`;

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
      pct(
        s.ctr
      )
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

          <div
            class="delta neutral"
          >
            за 60 дней
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

          <th>
            Кампания
          </th>

          <th>
            Расход
          </th>

          <th>
            Показы
          </th>

          <th>
            Клики
          </th>

          <th>
            CTR
          </th>

          <th>
            CPC
          </th>

        </tr>

      </thead>


      <tbody>

        ${campaigns.map(
          campaign => `

            <tr>

              <td>
                ${escapeHtml(
                  campaign.name
                )}
              </td>

              <td>
                ${money(
                  campaign.spend
                )}
              </td>

              <td>
                ${number(
                  campaign.impressions
                )}
              </td>

              <td>
                ${number(
                  campaign.clicks
                )}
              </td>

              <td>
                ${pct(
                  campaign.ctr
                )}
              </td>

              <td>
                ${money(
                  campaign.avg_cpc
                )}
              </td>

            </tr>

          `
        ).join("")}

      </tbody>

    </table>
  `;
}


/* =========================================================
   RIGHT SUMMARY
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
          b.spend
          - a.spend
      )[0];


  const bestCtr =
    campaigns
      .slice()
      .sort(
        (a, b) =>
          b.ctr
          - a.ctr
      )[0];


  const container =
    document.getElementById(
      "budgetPreview"
    );


  if (!container) {
    return;
  }


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

  const summary =
    DATA.creative_summary;

  if (!summary) {
    return;
  }


  const priority =
    document.getElementById(
      "priorityAlerts"
    );


  priority.innerHTML = `

    <article
      class="alert-card opportunity"
    >

      <div class="severity">
        УСПЕШНЫЕ
      </div>

      <h4>
        ${summary.successful}
        креативов
      </h4>

      <p>
        Score 70+ относительно
        других визуалов
        той же кампании.
      </p>

    </article>


    <article
      class="alert-card warning"
    >

      <div class="severity">
        ВЫГОРАНИЕ
      </div>

      <h4>
        ${summary.fatigue}
        креативов
      </h4>

      <p>
        CTR падает,
        одновременно CPC растёт.
      </p>

    </article>


    <article
      class="alert-card critical"
    >

      <div class="severity">
        СЛАБЫЕ
      </div>

      <h4>
        ${summary.weak}
        креативов
      </h4>

      <p>
        Score ниже 45.
      </p>

    </article>

  `;
}


/* =========================================================
   CREATIVE CARDS
========================================================= */

function renderCreatives() {

  const container =
    document.getElementById(
      "creativeGrid"
    );


  const heading =
    document.querySelector(
      "#creatives h2"
    );

  const subtitle =
    document.querySelector(
      "#creatives .section-head p"
    );


  if (heading) {

    heading.textContent =
      "Creative Intelligence";
  }


  if (subtitle) {

    subtitle.textContent =
      (
        "Какие именно картинки "
        + "и видео работают лучше."
      );
  }


  const creatives =
    DATA.creatives || [];


  if (!creatives.length) {

    container.innerHTML = `

      <div class="note">
        Визуальные креативы
        не найдены.
      </div>
    `;

    return;
  }


  container.innerHTML =
    creatives
      .map(
        creativeCard
      )
      .join("");
}


function creativeCard(
  creative
) {

  const state =
    creativeStatus(
      creative.status
    );


  const score =
    creative.score === null
      || creative.score
      === undefined
      ? "—"
      : creative.score;


  const trend =
    creative.trend || {};


  const preview =
    creative.preview_url
    || creative.thumbnail_url
    || creative.original_url
    || null;


  const shared =
    creative.shared_ad_ids
    || [];


  const ads =
    creative.ad_ids
    || [];


  const attributionNote =
    creative.status
      === "unattributable"

      ? `
        <div
          style="
            margin-top:12px;
            padding:10px;
            border-radius:8px;
            background:#161b26;
            font-size:10px;
            line-height:1.5;
            color:#aab9c9;
          "
        >
          В объявлении несколько
          визуалов. Яндекс отдаёт
          общую статистику объявления,
          поэтому определить победителя
          нельзя.
        </div>
      `

      : shared.length

      ? `
        <div
          style="
            margin-top:12px;
            padding:10px;
            border-radius:8px;
            background:#161b26;
            font-size:10px;
            color:#aab9c9;
          "
        >
          Часть показов этого креатива
          исключена из Score, поскольку
          она относится к объявлениям
          с несколькими ассетами.
        </div>
      `

      : "";


  return `

    <article
      class="creative"
      style="
        overflow:hidden;
      "
    >

      ${
        preview

          ? `

            <div
              style="
                width:100%;
                aspect-ratio:16/10;
                border-radius:10px;
                overflow:hidden;
                background:#07111f;
                margin-bottom:16px;
                display:flex;
                align-items:center;
                justify-content:center;
              "
            >

              <img
                src="${escapeAttribute(
                  preview
                )}"
                alt="Creative preview"
                loading="lazy"
                style="
                  width:100%;
                  height:100%;
                  object-fit:contain;
                "
              >

            </div>

          `

          : `

            <div
              style="
                width:100%;
                aspect-ratio:16/10;
                border-radius:10px;
                background:#07111f;
                margin-bottom:16px;
                display:flex;
                align-items:center;
                justify-content:center;
                color:#567089;
                font-size:11px;
              "
            >
              Нет превью
            </div>

          `
      }


      <div
        class="creative-head"
      >

        <div>

          <div
            style="
              font-size:9px;
              color:#7990a8;
              margin-bottom:4px;
            "
          >
            ${escapeHtml(
              creative.kind
              === "image"
                ? "IMAGE"
                : creative.kind
                  === "video"
                  ? "VIDEO"
                  : "CREATIVE"
            )}
          </div>


          <h4>
            ${
              escapeHtml(
                creative.name
                || (
                  creative.kind
                  === "image"

                  ? (
                    "Image "
                    + shorten(
                      creative.asset_id
                    )
                  )

                  : (
                    "Creative "
                    + creative.asset_id
                  )
                )
              )
            }
          </h4>

        </div>


        <span
          class="fatigue"
          title="Creative Score"
        >
          ${score}
        </span>

      </div>


      <div
        style="
          margin-top:8px;
          font-size:10px;
          color:#8ea2bb;
          line-height:1.45;
        "
      >
        ${escapeHtml(
          creative.campaign_name
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

        ${pill(
          state.icon
          + " "
          + state.label
        )}

        ${pill(
          creative.network
        )}

        ${pill(
          creative.asset_type
          || creative.kind
        )}

      </div>


      <div
        class="stats"
        style="
          margin-top:15px;
        "
      >

        ${miniStat(
          "CTR",
          pct(
            creative.ctr
          )
        )}

        ${miniStat(
          "CPC",
          money(
            creative.avg_cpc
          )
        )}

        ${miniStat(
          "Клики",
          number(
            creative.clicks
          )
        )}

        ${miniStat(
          "Расход",
          money(
            creative.spend
          )
        )}

      </div>


      ${
        creative.baseline_ctr
        !== undefined

        ? `

          <div
            style="
              margin-top:14px;
              padding-top:12px;
              border-top:1px solid #20354e;
              font-size:10px;
            "
          >

            ${comparisonRow(
              "CTR",
              creative.ctr,
              creative.baseline_ctr,
              "%"
            )}

            ${comparisonRow(
              "CPC",
              creative.avg_cpc,
              creative.baseline_cpc,
              "₽"
            )}

          </div>

        `

        : ""
      }


      <div
        style="
          margin-top:14px;
          padding-top:12px;
          border-top:1px solid #20354e;
        "
      >

        ${trendRow(
          "CTR 7 дней",
          trend.ctr_change,
          false
        )}

        ${trendRow(
          "CPC 7 дней",
          trend.cpc_change,
          true
        )}

      </div>


      <p>
        ${escapeHtml(
          creative.reason
          || ""
        )}
      </p>


      <div
        style="
          margin-top:10px;
          font-size:9px;
          color:#667d95;
        "
      >
        Используется в
        ${ads.length}
        объявлениях
      </div>


      ${attributionNote}

    </article>
  `;
}


/* =========================================================
   UI HELPERS
========================================================= */

function creativeStatus(
  status
) {

  const map = {

    successful: {
      icon: "🟢",
      label: "Успешный",
    },

    normal: {
      icon: "🟡",
      label: "Средний",
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

    no_peers: {
      icon: "⚪",
      label: "Не с чем сравнить",
    },

    unattributable: {
      icon: "⚫",
      label: "Нельзя определить",
    },
  };


  return (
    map[status]
    || map.normal
  );
}


function miniStat(
  label,
  value
) {

  return `

    <div class="mini">

      <span>
        ${escapeHtml(label)}
      </span>

      <strong>
        ${escapeHtml(value)}
      </strong>

    </div>
  `;
}


function pill(text) {

  return `

    <span
      style="
        padding:5px 8px;
        border-radius:7px;
        background:#0a1726;
        font-size:9px;
      "
    >
      ${escapeHtml(text)}
    </span>
  `;
}


function trendRow(
  title,
  value,
  inverse
) {

  value =
    Number(value || 0);


  const good =
    inverse
      ? value < 0
      : value > 0;


  const bad =
    inverse
      ? value > 0
      : value < 0;


  const color =
    good
      ? "#52d39a"
      : bad
        ? "#ff6b72"
        : "#8ea2bb";


  return `

    <div
      style="
        display:flex;
        justify-content:space-between;
        margin-top:6px;
        font-size:10px;
      "
    >

      <span
        style="
          color:#8ea2bb;
        "
      >
        ${escapeHtml(title)}
      </span>


      <strong
        style="
          color:${color};
        "
      >
        ${
          value > 0
            ? "+"
            : ""
        }${value.toFixed(1)}%
      </strong>

    </div>
  `;
}


function comparisonRow(
  label,
  value,
  baseline,
  suffix
) {

  value =
    Number(value || 0);

  baseline =
    Number(baseline || 0);


  const difference =
    baseline
      ? (
          (
            value - baseline
          )
          / baseline
          * 100
        )
      : 0;


  return `

    <div
      style="
        display:flex;
        justify-content:space-between;
        margin-top:6px;
      "
    >

      <span
        style="
          color:#8ea2bb;
        "
      >
        ${escapeHtml(label)}
        vs медиана
      </span>


      <strong>
        ${
          value.toFixed(2)
        }${suffix}
        /
        ${
          baseline.toFixed(2)
        }${suffix}
      </strong>

    </div>
  `;
}


function shorten(
  value
) {

  const text =
    String(value || "");

  if (text.length <= 12) {
    return text;
  }

  return (
    text.slice(0, 6)
    + "…"
    + text.slice(-5)
  );
}


/* =========================================================
   NAVIGATION
========================================================= */

document
  .querySelectorAll(
    ".nav"
  )
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


const refreshButton =
  document.getElementById(
    "refreshBtn"
  );


if (refreshButton) {

  refreshButton.addEventListener(
    "click",
    async () => {

      const password =
        sessionStorage.getItem(
          "marketingRadarPassword"
        );

      if (!password) {
        return;
      }

      DATA =
        await loadEncryptedReport(
          password
        );

      render();
    }
  );
}


function showSection(
  id
) {

  document
    .querySelectorAll(
      ".section"
    )
    .forEach(
      section => {

        section.classList.remove(
          "active"
        );
      }
    );


  document
    .querySelectorAll(
      ".nav"
    )
    .forEach(
      button => {

        button.classList.toggle(
          "active",
          button.dataset.section
          === id
        );
      }
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
      "Актуальные показатели Яндекс Директа.",
    ],

    alerts: [
      "Аномалии",
      "Автоматический контроль отклонений.",
    ],

    budget: [
      "Budget Optimizer",
      "Анализ эффективности расходов.",
    ],

    creatives: [
      "Creative Intelligence",
      (
        "Какие именно визуалы "
        + "работают лучше остальных."
      ),
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

function formatDate(
  value
) {

  if (!value) {
    return "—";
  }

  return new Date(
    value
  ).toLocaleString(
    "ru-RU"
  );
}


function escapeHtml(
  value
) {

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


function escapeAttribute(
  value
) {

  return escapeHtml(
    value
  );
}


/* =========================================================
   START
========================================================= */

start();
