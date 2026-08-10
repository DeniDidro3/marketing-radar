let DATA = null;
let ALERT_FILTER = "all";

const AUDIENCE_FILTERS = {
  age: new Set(),
  gender: new Set(),
  income_grade: new Set(),
  device: new Set(),
};

let AUDIENCE_METRIC = "cost";

const fmt = new Intl.NumberFormat("ru-RU");
const money = v => `${fmt.format(Math.round(Number(v || 0)))} ₽`;
const number = v => fmt.format(Math.round(Number(v || 0)));
const decimal = v => Number(v || 0).toLocaleString("ru-RU", { maximumFractionDigits: 2 });
const pct = v => `${Number(v || 0).toFixed(2)}%`;
const esc = v => String(v ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

/* ============================== CRYPTO ============================== */

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveKey(password, salt, iterations) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: "SHA-256"
    },
    material,
    {
      name: "AES-GCM",
      length: 256
    },
    false,
    ["decrypt"]
  );
}

async function decryptPayload(payload, password) {
  const key = await deriveKey(
    password,
    base64ToBytes(payload.salt),
    payload.iterations
  );

  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64ToBytes(payload.nonce)
    },
    key,
    base64ToBytes(payload.ciphertext)
  );

  return JSON.parse(
    new TextDecoder().decode(plaintext)
  );
}

async function loadEncryptedReport(password) {
  const response = await fetch(
    `data/report.enc?t=${Date.now()}`
  );

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status}`
    );
  }

  return decryptPayload(
    await response.json(),
    password
  );
}

/* ============================== LOGIN ============================== */

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
          Введите пароль для расшифровки данных.
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

    if (!input.value) {
      return;
    }

    button.disabled = true;

    button.textContent =
      "Расшифровка...";

    try {

      DATA =
        await loadEncryptedReport(
          input.value
        );

      sessionStorage.setItem(
        "marketingRadarPassword",
        input.value
      );

      document
        .getElementById(
          "loginOverlay"
        )
        ?.remove();

      render();

    } catch (error) {

      console.error(error);

      document
        .getElementById(
          "loginError"
        )
        .textContent =
          "Неверный пароль или не удалось загрузить отчёт.";

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
    e => {

      if (
        e.key === "Enter"
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

    } catch (error) {

      console.error(error);

      sessionStorage.removeItem(
        "marketingRadarPassword"
      );
    }
  }

  showLogin();
}

/* ============================== UI SHELL ============================== */

const ADVANCED_SECTIONS = [
  ["keywords", "Ключевые фразы"],
  ["queries", "Поисковые запросы"],
  ["placements", "Площадки РСЯ"],
  ["audience", "Аудитория"],
  ["geo", "География"],
  ["positions", "Позиции поиска"],
];

const REMOVED_SECTIONS = [
  "attribution",
  "goals",
  "media",
  "retargeting",
];

function ensureAdvancedUI() {

  const nav =
    document.querySelector(
      ".sidebar nav"
    );

  for (
    const id
    of REMOVED_SECTIONS
  ) {

    nav
      ?.querySelector(
        `[data-section="${id}"]`
      )
      ?.remove();

    document
      .getElementById(
        id
      )
      ?.remove();
  }

  if (nav) {

    nav.style.overflowY =
      "auto";

    nav.style.paddingRight =
      "3px";

    for (
      const [id, label]
      of ADVANCED_SECTIONS
    ) {

      if (
        !nav.querySelector(
          `[data-section="${id}"]`
        )
      ) {

        const button =
          document.createElement(
            "button"
          );

        button.className =
          "nav";

        button.dataset.section =
          id;

        button.textContent =
          label;

        nav.appendChild(
          button
        );
      }
    }
  }

  const main =
    document.querySelector(
      "main"
    );

  const footer =
    document.querySelector(
      "main footer"
    );

  if (!main) {
    return;
  }

  const definitions = {

    keywords: [
      "Ключевые фразы",
      "Какие рекламные ключи дают Order, регистрации и прохождения опросов.",
      "keywordBody",
    ],

    queries: [
      "Search Query Intelligence",
      "Что реально вводят пользователи: новые ключи, минус-слова и семантическое расширение.",
      "queryBody",
    ],

    placements: [
      "Placement Intelligence",
      "Какие площадки РСЯ дают Order, регистрации и опросы, а какие тратят бюджет без результата.",
      "placementBody",
    ],

    audience: [
      "Audience Intelligence",
      "Комбинируйте возраст, пол, платежеспособность и устройство. Ниже — фильтры и диаграммы.",
      "audienceBody",
    ],

    geo: [
      "Geo Intelligence",
      "Где фактически находятся пользователи и как это соотносится с таргетингом.",
      "geoBody",
    ],

    positions: [
      "Search Position Economics",
      "Экономика поисковых блоков: объём трафика, ставка, CPC и три типа конверсий.",
      "positionBody",
    ],
  };

  for (
    const [
      id,
      [
        title,
        copy,
        bodyId
      ]
    ]
    of Object.entries(
      definitions
    )
  ) {

    if (
      document.getElementById(
        id
      )
    ) {
      continue;
    }

    const section =
      document.createElement(
        "section"
      );

    section.id =
      id;

    section.className =
      "section";

    section.innerHTML = `

      <div
        class="section-head top"
      >

        <div>

          <h2>
            ${esc(title)}
          </h2>

          <p>
            ${esc(copy)}
          </p>

        </div>

      </div>

      <div
        id="${bodyId}"
      ></div>

    `;

    if (footer) {

      footer.parentNode.insertBefore(
        section,
        footer
      );

    } else {

      main.appendChild(
        section
      );
    }
  }
}

function prepareStaticCopy() {

  const campaignTitle =
    document.querySelector(
      "#overview .split .panel:first-child .panel-head h3"
    );

  const campaignCopy =
    document.querySelector(
      "#overview .split .panel:first-child .panel-head p"
    );

  const budgetCopy =
    document.querySelector(
      "#overview .split .panel:nth-child(2) .panel-head p"
    );

  const attentionTitle =
    document.querySelector(
      "#overview .section-head h3"
    );

  const attentionCopy =
    document.querySelector(
      "#overview .section-head p"
    );

  if (campaignTitle) {

    campaignTitle.textContent =
      "Показатели кампаний";
  }

  if (campaignCopy) {

    campaignCopy.textContent =
      "Расход, клики, CTR, CPC и раздельные конверсии: Order / вебинары / опросы.";
  }

  if (budgetCopy) {

    budgetCopy.textContent =
      "Сводка по расходам и эффективности рекламы.";
  }

  if (attentionTitle) {

    attentionTitle.textContent =
      "Что требует внимания";
  }

  if (attentionCopy) {

    attentionCopy.textContent =
      "Сигналы строятся из нескольких разрезов API, а не только из таблицы кампаний.";
  }

  const creativeTitle =
    document.querySelector(
      "#creatives h2"
    );

  const creativeCopy =
    document.querySelector(
      "#creatives .section-head p"
    );

  if (creativeTitle) {

    creativeTitle.textContent =
      "Creative Intelligence";
  }

  if (creativeCopy) {

    creativeCopy.textContent =
      "Какие именно картинки и видео работают лучше.";
  }
}

/* ============================== RENDER ============================== */

function render() {

  if (!DATA) {
    return;
  }

  ensureAdvancedUI();

  prepareStaticCopy();

  renderMeta();

  renderOverview();

  renderAlerts();

  renderBudget();

  renderCreatives();

  renderKeywords();

  renderQueries();

  renderPlacements();

  renderAudience();

  renderGeo();

  renderPositions();
}

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
}

/* ============================== CONVERSIONS ============================== */

function conversionBreakdown(
  x = {}
) {

  const order =
    Number(
      x.order_conversions
      || 0
    );

  const webinar =
    Number(
      x.webinar_conversions
      || 0
    );

  const survey =
    Number(
      x.survey_conversions
      || 0
    );

  return {
    order,
    webinar,
    survey,
    total:
      order
      + webinar
      + survey,
  };
}

function cpa(
  cost,
  conversions
) {

  cost =
    Number(
      cost
      || 0
    );

  conversions =
    Number(
      conversions
      || 0
    );

  return (
    conversions > 0
  )
    ? cost
      / conversions
    : 0;
}

/* ============================== PERIOD / OVERVIEW ============================== */

function selectedDays() {

  return Math.max(
    1,
    Number(
      document
        .getElementById(
          "periodSelect"
        )
        ?.value
      || 30
    )
  );
}

function finalCampaign(
  c
) {

  const impressions =
    Number(
      c.impressions
      || 0
    );

  const clicks =
    Number(
      c.clicks
      || 0
    );

  const spend =
    Number(
      c.spend
      ??
      c.cost
      ??
      0
    );

  const order_conversions =
    Number(
      c.order_conversions
      || 0
    );

  const webinar_conversions =
    Number(
      c.webinar_conversions
      || 0
    );

  const survey_conversions =
    Number(
      c.survey_conversions
      || 0
    );

  const conversions =
    order_conversions
    + webinar_conversions
    + survey_conversions;

  return {

    ...c,

    impressions,

    clicks,

    spend,

    order_conversions,

    webinar_conversions,

    survey_conversions,

    conversions,

    ctr:
      impressions
        ? clicks
          / impressions
          * 100
        : 0,

    avg_cpc:
      clicks
        ? spend
          / clicks
        : 0,

    order_cr:
      clicks
        ? order_conversions
          / clicks
          * 100
        : 0,

    webinar_cr:
      clicks
        ? webinar_conversions
          / clicks
          * 100
        : 0,

    survey_cr:
      clicks
        ? survey_conversions
          / clicks
          * 100
        : 0,

    order_cpa:
      cpa(
        spend,
        order_conversions
      ),

    webinar_cpa:
      cpa(
        spend,
        webinar_conversions
      ),

    survey_cpa:
      cpa(
        spend,
        survey_conversions
      ),
  };
}

function summarizeCampaigns(
  campaigns
) {

  const s =
    campaigns.reduce(
      (
        a,
        c
      ) => {

        a.impressions +=
          Number(
            c.impressions
            || 0
          );

        a.clicks +=
          Number(
            c.clicks
            || 0
          );

        a.spend +=
          Number(
            c.spend
            || 0
          );

        a.order_conversions +=
          Number(
            c.order_conversions
            || 0
          );

        a.webinar_conversions +=
          Number(
            c.webinar_conversions
            || 0
          );

        a.survey_conversions +=
          Number(
            c.survey_conversions
            || 0
          );

        return a;
      },
      {
        impressions: 0,
        clicks: 0,
        spend: 0,
        order_conversions: 0,
        webinar_conversions: 0,
        survey_conversions: 0,
      }
    );

  s.conversions =
    s.order_conversions
    + s.webinar_conversions
    + s.survey_conversions;

  s.ctr =
    s.impressions
      ? s.clicks
        / s.impressions
        * 100
      : 0;

  s.avg_cpc =
    s.clicks
      ? s.spend
        / s.clicks
      : 0;

  s.order_cpa =
    cpa(
      s.spend,
      s.order_conversions
    );

  s.webinar_cpa =
    cpa(
      s.spend,
      s.webinar_conversions
    );

  s.survey_cpa =
    cpa(
      s.spend,
      s.survey_conversions
    );

  return s;
}

function overviewSnapshot() {

  const days =
    selectedDays();

  const rows =
    Array.isArray(
      DATA.daily
    )
      ? DATA.daily
      : [];

  if (
    !rows.length
  ) {

    const campaigns =
      (
        DATA.campaigns
        || []
      )
        .map(
          finalCampaign
        )
        .sort(
          (
            a,
            b
          ) =>
            b.spend
            -
            a.spend
        );

    return {
      days,
      campaigns,
      summary:
        summarizeCampaigns(
          campaigns
        ),
    };
  }

  const dates =
    rows
      .map(
        r =>
          r.date
      )
      .filter(
        Boolean
      )
      .sort();

  if (
    !dates.length
  ) {

    const campaigns =
      (
        DATA.campaigns
        || []
      )
        .map(
          finalCampaign
        )
        .sort(
          (
            a,
            b
          ) =>
            b.spend
            -
            a.spend
        );

    return {
      days,
      campaigns,
      summary:
        summarizeCampaigns(
          campaigns
        ),
    };
  }

  const latest =
    new Date(
      `${
        dates.at(-1)
      }T00:00:00Z`
    );

  const start =
    new Date(
      latest
    );

  start.setUTCDate(
    start.getUTCDate()
    -
    days
    +
    1
  );

  const map =
    new Map();

  for (
    const row
    of rows
  ) {

    if (
      !row.date
    ) {
      continue;
    }

    const d =
      new Date(
        `${row.date}T00:00:00Z`
      );

    if (
      d < start
      ||
      d > latest
    ) {
      continue;
    }

    const id =
      String(
        row.campaign_id
        || ""
      );

    if (
      !id
    ) {
      continue;
    }

    if (
      !map.has(
        id
      )
    ) {

      map.set(
        id,
        {
          campaign_id:
            id,

          name:
            row.campaign_name
            ||
            "Без названия",

          impressions:
            0,

          clicks:
            0,

          spend:
            0,

          order_conversions:
            0,

          webinar_conversions:
            0,

          survey_conversions:
            0,
        }
      );
    }

    const item =
      map.get(
        id
      );

    item.impressions +=
      Number(
        row.impressions
        || 0
      );

    item.clicks +=
      Number(
        row.clicks
        || 0
      );

    item.spend +=
      Number(
        row.cost
        || 0
      );

    item.order_conversions +=
      Number(
        row.order_conversions
        || 0
      );

    item.webinar_conversions +=
      Number(
        row.webinar_conversions
        || 0
      );

    item.survey_conversions +=
      Number(
        row.survey_conversions
        || 0
      );
  }

  const campaigns =
    [
      ...map.values()
    ]
      .map(
        finalCampaign
      )
      .sort(
        (
          a,
          b
        ) =>
          b.spend
          -
          a.spend
      );

  return {

    days,

    campaigns,

    summary:
      summarizeCampaigns(
        campaigns
      ),
  };
}

function renderOverview() {

  const snap =
    overviewSnapshot();

  const s =
    snap.summary;

  const heroHeadline =
    document.getElementById(
      "heroHeadline"
    );

  const heroCopy =
    document.getElementById(
      "heroCopy"
    );

  const health =
    document.getElementById(
      "healthScore"
    );

  if (
    heroHeadline
  ) {

    heroHeadline.textContent =
      "Marketing Radar работает";
  }

  if (
    heroCopy
  ) {

    heroCopy.textContent =
      `${
        number(
          snap.campaigns.length
        )
      } кампаний · `
      +
      `${
        money(
          s.spend
        )
      } расходов · `
      +
      `${
        number(
          s.clicks
        )
      } кликов · `
      +
      `Order ${
        decimal(
          s.order_conversions
        )
      } · `
      +
      `Вебинары ${
        decimal(
          s.webinar_conversions
        )
      } · `
      +
      `Опросы ${
        decimal(
          s.survey_conversions
        )
      }`;
  }

  if (
    health
  ) {

    health.textContent =
      "LIVE";
  }

  const kpis =
    document.getElementById(
      "kpis"
    );

  if (
    kpis
  ) {

    const items = [

      [
        "Расход",
        money(
          s.spend
        ),
      ],

      [
        "Показы",
        number(
          s.impressions
        ),
      ],

      [
        "Клики",
        number(
          s.clicks
        ),
      ],

      [
        "CTR",
        pct(
          s.ctr
        ),
      ],
    ];

    kpis.innerHTML =
      items
        .map(
          (
            [
              label,
              value
            ]
          ) => `

            <div
              class="kpi"
            >

              <div
                class="label"
              >
                ${esc(label)}
              </div>

              <div
                class="value"
              >
                ${esc(value)}
              </div>

              <div
                class="delta neutral"
              >
                за ${snap.days} дней
              </div>

            </div>

          `
        )
        .join("");
  }

  renderCampaignTable(
    snap
  );

  renderOverviewSummary(
    snap
  );

  renderPriorityInsights(
    snap
  );
}

function renderCampaignTable(
  snap
) {

  const box =
    document.getElementById(
      "campaignTable"
    );

  if (
    !box
  ) {
    return;
  }

  box.innerHTML = `

    <div
      style="
        overflow:auto;
      "
    >

      <table
        class="table"
      >

        <thead>

          <tr>

            <th>
              Кампания
            </th>

            <th>
              Расход
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

            <th>
              Order
            </th>

            <th>
              CPA Order
            </th>

            <th>
              Вебинар
            </th>

            <th>
              Опрос
            </th>

            <th>
              CPA опрос
            </th>

          </tr>

        </thead>

        <tbody>

          ${
            snap
              .campaigns
              .map(
                c => `

                  <tr>

                    <td>
                      <strong>
                        ${esc(c.name)}
                      </strong>
                    </td>

                    <td>
                      ${money(c.spend)}
                    </td>

                    <td>
                      ${number(c.clicks)}
                    </td>

                    <td>
                      ${pct(c.ctr)}
                    </td>

                    <td>
                      ${
                        c.avg_cpc
                          ? money(
                              c.avg_cpc
                            )
                          : "—"
                      }
                    </td>

                    <td>
                      ${decimal(c.order_conversions)}
                    </td>

                    <td>
                      ${
                        c.order_cpa
                          ? money(
                              c.order_cpa
                            )
                          : "—"
                      }
                    </td>

                    <td>
                      ${decimal(c.webinar_conversions)}
                    </td>

                    <td>
                      ${decimal(c.survey_conversions)}
                    </td>

                    <td>
                      ${
                        c.survey_cpa
                          ? money(
                              c.survey_cpa
                            )
                          : "—"
                      }
                    </td>

                  </tr>

                `
              )
              .join("")
          }

        </tbody>

      </table>

    </div>

  `;
}

function renderOverviewSummary(
  snap
) {

  const box =
    document.getElementById(
      "budgetPreview"
    );

  if (
    !box
  ) {
    return;
  }

  const s =
    snap.summary;

  const rows = [

    [
      "Средний CPC",
      "По аккаунту",
      s.avg_cpc
        ? money(
            s.avg_cpc
          )
        : "—",
    ],

    [
      "Order",
      `За ${snap.days} дней`,
      decimal(
        s.order_conversions
      ),
    ],

    [
      "CPA Order",
      "Цена выполнения Order",
      s.order_cpa
        ? money(
            s.order_cpa
          )
        : "—",
    ],

    [
      "Регистрации на вебинары/митапы",
      "ID целей пока не добавлены",
      decimal(
        s.webinar_conversions
      ),
    ],

    [
      "Прохождения опросов",
      "BHT + White Paper AXE",
      decimal(
        s.survey_conversions
      ),
    ],

    [
      "CPA опроса",
      "Цена прохождения опроса",
      s.survey_cpa
        ? money(
            s.survey_cpa
          )
        : "—",
    ],
  ];

  box.innerHTML =
    rows
      .map(
        r => `

          <div
            class="budget-item"
          >

            <div>

              <strong>
                ${esc(r[0])}
              </strong>

              <small>
                ${esc(r[1])}
              </small>

            </div>

            <strong>
              ${esc(r[2])}
            </strong>

          </div>

        `
      )
      .join("");
}

function advancedSignals() {

  const signals =
    [];

  const q =
    DATA
      .search_queries
      ?.summary
    || {};

  const p =
    DATA
      .placements
      ?.summary
    || {};

  const a =
    DATA
      .audience
      ?.summary
    || {};

  if (
    Number(
      q.negative_candidates
      || 0
    ) > 0
  ) {

    signals.push({

      severity:
        "critical",

      label:
        "ПОИСКОВЫЕ ЗАПРОСЫ",

      title:
        `${
          number(
            q.negative_candidates
          )
        } кандидатов в минус-слова`,

      text:
        `Потенциальный неэффективный расход: ${
          money(
            q.negative_candidate_spend
          )
        }.`,
    });
  }

  if (
    Number(
      p.waste_candidates
      || 0
    ) > 0
  ) {

    signals.push({

      severity:
        "critical",

      label:
        "ПЛОЩАДКИ РСЯ",

      title:
        `${
          number(
            p.waste_candidates
          )
        } площадок требуют проверки`,

      text:
        `Расход по кандидатам на исключение: ${
          money(
            p.waste_candidate_spend
          )
        }.`,
    });
  }

  if (
    Number(
      a.opportunities
      || 0
    ) > 0
  ) {

    signals.push({

      severity:
        "opportunity",

      label:
        "АУДИТОРИЯ",

      title:
        `${
          number(
            a.opportunities
          )
        } сильных сегментов`,

      text:
        "Order CPA заметно ниже среднего — кандидаты на ручную проверку корректировок.",
    });
  }

  return signals;
}

function renderPriorityInsights(
  snap
) {

  const box =
    document.getElementById(
      "priorityAlerts"
    );

  if (
    !box
  ) {
    return;
  }

  const signals =
    advancedSignals();

  if (
    !signals.length
  ) {

    const c =
      snap.campaigns;

    const s =
      snap.summary;

    if (
      c[0]
    ) {

      signals.push({

        severity:
          "warning",

        label:
          "РАСХОД",

        title:
          c[0].name,

        text:
          `${
            money(
              c[0].spend
            )
          } — максимальный расход среди кампаний.`,
      });
    }

    const highCpc =
      c
        .filter(
          x =>
            x.clicks
            >= 5
        )
        .sort(
          (
            a,
            b
          ) =>
            b.avg_cpc
            -
            a.avg_cpc
        )[0];

    if (
      highCpc
    ) {

      signals.push({

        severity:
          "warning",

        label:
          "CPC",

        title:
          highCpc.name,

        text:
          `CPC ${
            money(
              highCpc.avg_cpc
            )
          } при среднем ${
            s.avg_cpc
              ? money(
                  s.avg_cpc
                )
              : "—"
          }.`,
      });
    }

    const bestCtr =
      c
        .filter(
          x =>
            x.clicks
            >= 10
        )
        .sort(
          (
            a,
            b
          ) =>
            b.ctr
            -
            a.ctr
        )[0];

    if (
      bestCtr
    ) {

      signals.push({

        severity:
          "opportunity",

        label:
          "CTR",

        title:
          bestCtr.name,

        text:
          `Лучший CTR: ${
            pct(
              bestCtr.ctr
            )
          }.`,
      });
    }
  }

  box.innerHTML =
    signals
      .slice(
        0,
        3
      )
      .map(
        x => `

          <article
            class="alert-card ${x.severity}"
          >

            <div
              class="severity"
            >
              ${esc(x.label)}
            </div>

            <h4>
              ${esc(x.title)}
            </h4>

            <p>
              ${esc(x.text)}
            </p>

          </article>

        `
      )
      .join("");
}

/* ============================== ALERTS ============================== */

function buildAlerts() {

  const snap =
    overviewSnapshot();

  const s =
    snap.summary;

  const alerts =
    [];

  for (
    const c
    of snap.campaigns
  ) {

    if (
      c.conversions === 0
      &&
      c.clicks >= 20
      &&
      c.spend >= 1000
    ) {

      alerts.push({

        severity:
          "critical",

        label:
          "Критично",

        title:
          "Расход без конверсий",

        text:
          `${
            c.name
          }: ${
            money(
              c.spend
            )
          }, ${
            number(
              c.clicks
            )
          } кликов, 0 конверсий.`,

        meta:
          `CTR ${
            pct(
              c.ctr
            )
          }`,
      });
    }

    if (
      s.avg_cpc
      &&
      c.avg_cpc
      >
      s.avg_cpc
      *
      1.4
      &&
      c.clicks >= 5
    ) {

      alerts.push({

        severity:
          "warning",

        label:
          "Внимание",

        title:
          "CPC выше среднего",

        text:
          `${
            c.name
          }: CPC ${
            money(
              c.avg_cpc
            )
          } против ${
            money(
              s.avg_cpc
            )
          } в среднем.`,

        meta:
          `${
            number(
              c.clicks
            )
          } кликов`,
      });
    }
  }

  for (
    const signal
    of advancedSignals()
  ) {

    alerts.push({

      severity:
        signal.severity,

      label:
        signal.severity
        === "critical"
          ? "Критично"
          : signal.severity
            === "opportunity"
            ? "Возможность"
            : "Внимание",

      title:
        signal.title,

      text:
        signal.text,

      meta:
        signal.label,
    });
  }

  return alerts;
}

function renderAlerts() {

  const box =
    document.getElementById(
      "allAlerts"
    );

  if (
    !box
  ) {
    return;
  }

  const alerts =
    buildAlerts();

  const badge =
    document.getElementById(
      "navAlertCount"
    );

  if (
    badge
  ) {

    badge.textContent =
      number(
        alerts.length
      );
  }

  document
    .querySelectorAll(
      "#alertFilters [data-filter]"
    )
    .forEach(
      btn => {

        btn.classList.toggle(
          "active",
          btn.dataset.filter
          === ALERT_FILTER
        );
      }
    );

  const filtered =
    ALERT_FILTER
    === "all"
      ? alerts
      : alerts.filter(
          x =>
            x.severity
            === ALERT_FILTER
        );

  box.innerHTML =
    filtered.length

      ? filtered
          .map(
            x => `

              <article
                class="alert-row ${x.severity}"
              >

                <div
                  class="severity"
                >
                  ${esc(x.label)}
                </div>

                <div>

                  <h4>
                    ${esc(x.title)}
                  </h4>

                  <p>
                    ${esc(x.text)}
                  </p>

                </div>

                <div
                  class="meta"
                >
                  ${esc(x.meta || "")}
                </div>

              </article>

            `
          )
          .join("")

      : `
        <div
          class="note"
        >
          По выбранному фильтру сигналов нет.
        </div>
      `;
}

/* ============================== BUDGET ============================== */

function renderBudget() {

  const box =
    document.getElementById(
      "budgetTable"
    );

  if (
    !box
  ) {
    return;
  }

  const snap =
    overviewSnapshot();

  const s =
    snap.summary;

  function rec(
    c
  ) {

    if (
      c.conversions === 0
      &&
      c.clicks >= 20
    ) {

      return (
        "Проверить: расход без отслеживаемых конверсий"
      );
    }

    if (
      c.order_cpa
      &&
      s.order_cpa
      &&
      c.order_cpa
      <
      s.order_cpa
      *
      0.8
    ) {

      return (
        "Order CPA ниже среднего — потенциал для масштабирования"
      );
    }

    if (
      s.avg_cpc
      &&
      c.avg_cpc
      >
      s.avg_cpc
      *
      1.3
    ) {

      return (
        "Проверить высокий CPC"
      );
    }

    return (
      "Без явного сигнала"
    );
  }

  box.innerHTML = `

    <div
      style="
        overflow:auto;
      "
    >

      <table
        class="table"
      >

        <thead>

          <tr>

            <th>
              Кампания
            </th>

            <th>
              Расход
            </th>

            <th>
              Доля
            </th>

            <th>
              CPC
            </th>

            <th>
              Order
            </th>

            <th>
              CPA Order
            </th>

            <th>
              Вебинар
            </th>

            <th>
              Опрос
            </th>

            <th>
              CPA опрос
            </th>

            <th>
              Сигнал
            </th>

          </tr>

        </thead>

        <tbody>

          ${
            snap
              .campaigns
              .map(
                c => `

                  <tr>

                    <td>
                      <strong>
                        ${esc(c.name)}
                      </strong>
                    </td>

                    <td>
                      ${money(c.spend)}
                    </td>

                    <td>
                      ${
                        s.spend
                          ? (
                              c.spend
                              /
                              s.spend
                              *
                              100
                            )
                              .toFixed(
                                1
                              )
                          : "0.0"
                      }%
                    </td>

                    <td>
                      ${
                        c.avg_cpc
                          ? money(
                              c.avg_cpc
                            )
                          : "—"
                      }
                    </td>

                    <td>
                      ${decimal(c.order_conversions)}
                    </td>

                    <td>
                      ${
                        c.order_cpa
                          ? money(
                              c.order_cpa
                            )
                          : "—"
                      }
                    </td>

                    <td>
                      ${decimal(c.webinar_conversions)}
                    </td>

                    <td>
                      ${decimal(c.survey_conversions)}
                    </td>

                    <td>
                      ${
                        c.survey_cpa
                          ? money(
                              c.survey_cpa
                            )
                          : "—"
                      }
                    </td>

                    <td>
                      ${esc(rec(c))}
                    </td>

                  </tr>

                `
              )
              .join("")
          }

        </tbody>

      </table>

    </div>

  `;
}

/* ============================== CREATIVES ============================== */

function creativeStatus(
  status
) {

  return (
    {
      successful: [
        "🟢",
        "Успешный"
      ],

      normal: [
        "🟡",
        "Средний"
      ],

      weak: [
        "🔴",
        "Слабый"
      ],

      fatigue: [
        "🔥",
        "Выгорает"
      ],

      improving: [
        "🚀",
        "Улучшается"
      ],

      insufficient_data: [
        "⚪",
        "Мало данных"
      ],

      no_peers: [
        "⚪",
        "Не с чем сравнить"
      ],

      unattributable: [
        "⚫",
        "Нельзя определить"
      ],
    }[
      status
    ]
    ||
    [
      "⚪",
      "Без оценки"
    ]
  );
}

function renderCreatives() {

  const box =
    document.getElementById(
      "creativeGrid"
    );

  if (
    !box
  ) {
    return;
  }

  const rows =
    DATA.creatives
    || [];

  if (
    !rows.length
  ) {

    box.innerHTML =
      `
      <div
        class="note"
      >
        Визуальные креативы не найдены.
      </div>
      `;

    return;
  }

  box.innerHTML =
    rows
      .map(
        c => {

          const [
            icon,
            label
          ] =
            creativeStatus(
              c.status
            );

          const preview =
            c.preview_url
            ||
            c.thumbnail_url
            ||
            c.original_url;

          const score =
            c.score
            == null
              ? "—"
              : c.score;

          const note =
            c.status
            === "unattributable"
              ? (
                  "В объявлении несколько визуалов, поэтому статистику нельзя надёжно распределить."
                )
              : c.attribution
                === "proxy"
                ? (
                    "Proxy-оценка: статистика объявления с единственным визуальным ассетом."
                  )
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
                        src="${esc(preview)}"
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

                  : ""
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
                    ${
                      esc(
                        (
                          c.kind
                          || "creative"
                        )
                          .toUpperCase()
                      )
                    }
                  </div>

                  <h4>
                    ${
                      esc(
                        c.name
                        ||
                        `Creative ${
                          c.asset_id
                          || ""
                        }`
                      )
                    }
                  </h4>

                </div>

                <span
                  class="fatigue"
                >
                  ${score}
                </span>

              </div>

              <div
                style="
                  margin-top:8px;
                  font-size:10px;
                  color:#8ea2bb;
                "
              >
                ${
                  esc(
                    c.campaign_name
                    || ""
                  )
                }
              </div>

              <div
                style="
                  display:flex;
                  gap:6px;
                  flex-wrap:wrap;
                  margin-top:12px;
                "
              >

                ${
                  pill(
                    `${icon} ${label}`
                  )
                }

                ${
                  pill(
                    c.network
                    || "—"
                  )
                }

                ${
                  pill(
                    c.asset_type
                    ||
                    c.kind
                    ||
                    "—"
                  )
                }

              </div>

              <div
                class="stats"
                style="
                  margin-top:15px;
                "
              >

                ${
                  mini(
                    "CTR",
                    pct(
                      c.ctr
                    )
                  )
                }

                ${
                  mini(
                    "CPC",
                    c.avg_cpc
                      ? money(
                          c.avg_cpc
                        )
                      : "—"
                  )
                }

                ${
                  mini(
                    "Клики",
                    number(
                      c.clicks
                    )
                  )
                }

                ${
                  mini(
                    "Расход",
                    money(
                      c.spend
                    )
                  )
                }

                ${
                  mini(
                    "Order",
                    decimal(
                      c.order_conversions
                    )
                  )
                }

                ${
                  mini(
                    "Вебинар",
                    decimal(
                      c.webinar_conversions
                    )
                  )
                }

                ${
                  mini(
                    "Опрос",
                    decimal(
                      c.survey_conversions
                    )
                  )
                }

                ${
                  mini(
                    "CPA Order",
                    c.order_cpa
                      ? money(
                          c.order_cpa
                        )
                      : "—"
                  )
                }

              </div>

              <p>
                ${esc(c.reason || "")}
              </p>

              ${
                note
                  ? `
                    <div
                      class="note"
                      style="
                        margin-top:12px;
                      "
                    >
                      ${esc(note)}
                    </div>
                  `
                  : ""
              }

            </article>

          `;
        }
      )
      .join("");
}

function mini(
  label,
  value
) {

  return `

    <div
      class="mini"
    >

      <span>
        ${esc(label)}
      </span>

      <strong>
        ${esc(value)}
      </strong>

    </div>

  `;
}

function pill(
  text
) {

  return `

    <span
      style="
        padding:5px 8px;
        border-radius:7px;
        background:#0a1726;
        font-size:9px;
      "
    >
      ${esc(text)}
    </span>

  `;
}

/* ============================== GENERIC HELPERS ============================== */

function moduleEmpty(
  message
) {

  return `

    <div
      class="note"
    >
      ${esc(message)}
    </div>

  `;
}

function kpiGrid(
  items
) {

  return `

    <div
      class="kpi-grid"
    >

      ${
        items
          .map(
            (
              [
                label,
                value,
                note
              ]
            ) => `

              <div
                class="kpi"
              >

                <div
                  class="label"
                >
                  ${esc(label)}
                </div>

                <div
                  class="value"
                >
                  ${esc(value)}
                </div>

                <div
                  class="delta neutral"
                >
                  ${
                    esc(
                      note
                      ||
                      `за ${
                        DATA.meta?.period_days
                        || 60
                      } дней`
                    )
                  }
                </div>

              </div>

            `
          )
          .join("")
      }

    </div>

  `;
}

function table(
  headers,
  rowsHtml
) {

  return `

    <div
      class="panel"
    >

      <div
        style="
          overflow:auto;
        "
      >

        <table
          class="table"
        >

          <thead>

            <tr>
              ${
                headers
                  .map(
                    h =>
                      `<th>${esc(h)}</th>`
                  )
                  .join("")
              }
            </tr>

          </thead>

          <tbody>
            ${rowsHtml}
          </tbody>

        </table>

      </div>

    </div>

  `;
}

/* ============================== KEYWORDS ============================== */

function renderKeywords() {

  const box =
    document.getElementById(
      "keywordBody"
    );

  if (
    !box
  ) {
    return;
  }

  const rows =
    [
      ...(
        DATA.keywords
        || []
      )
    ];

  const s =
    DATA.keyword_summary
    || {};

  if (
    !rows.length
  ) {

    box.innerHTML =
      moduleEmpty(
        "Ключевые фразы не найдены или по ним нет статистики."
      );

    return;
  }

  rows.sort(
    (
      a,
      b
    ) =>
      Number(
        b.order_conversions
        || 0
      )
      -
      Number(
        a.order_conversions
        || 0
      )
      ||
      Number(
        b.survey_conversions
        || 0
      )
      -
      Number(
        a.survey_conversions
        || 0
      )
      ||
      Number(
        b.clicks
        || 0
      )
      -
      Number(
        a.clicks
        || 0
      )
  );

  box.innerHTML =
    kpiGrid([
      [
        "Ключевых фраз",
        number(
          s.total_keywords
          ??
          rows.length
        )
      ],
      [
        "Order",
        decimal(
          s.order_conversions
        )
      ],
      [
        "Вебинары",
        decimal(
          s.webinar_conversions
        )
      ],
      [
        "Опросы",
        decimal(
          s.survey_conversions
        )
      ],
    ])
    +
    `
      <div
        class="note"
        style="
          margin-bottom:12px;
        "
      >
        Рейтинг в первую очередь ориентируется на Order.
        Регистрации на вебинары/митапы пока показываются как 0,
        потому что ID этих целей ещё не добавлены.
      </div>
    `
    +
    table(
      [
        "#",
        "Ключевая фраза",
        "Order",
        "CPA Order",
        "Вебинар",
        "Опрос",
        "CPA опрос",
        "Клики",
        "CTR",
        "Расход",
        "Кампании",
      ],
      rows
        .map(
          (
            x,
            i
          ) => `

            <tr>

              <td>
                ${i + 1}
              </td>

              <td>
                <strong>
                  ${esc(x.keyword)}
                </strong>
              </td>

              <td>
                ${decimal(x.order_conversions)}
              </td>

              <td>
                ${
                  x.order_cpa
                    ? money(
                        x.order_cpa
                      )
                    : "—"
                }
              </td>

              <td>
                ${decimal(x.webinar_conversions)}
              </td>

              <td>
                ${decimal(x.survey_conversions)}
              </td>

              <td>
                ${
                  x.survey_cpa
                    ? money(
                        x.survey_cpa
                      )
                    : "—"
                }
              </td>

              <td>
                ${number(x.clicks)}
              </td>

              <td>
                ${pct(x.ctr)}
              </td>

              <td>
                ${money(x.cost)}
              </td>

              <td>
                ${
                  esc(
                    (
                      x.campaign_names
                      || []
                    )
                      .join(
                        ", "
                      )
                    ||
                    x.campaign_name
                    ||
                    "—"
                  )
                }
              </td>

            </tr>

          `
        )
        .join("")
    );
}

/* ============================== SEARCH QUERIES ============================== */

function queryRecommendation(
  value
) {

  return (
    {
      new_keyword_candidate:
        "🟢 Новый ключ",

      negative_candidate:
        "🔴 Минус-слово?",

      semantic_expansion_review:
        "🟡 Проверить расширение",

      converting:
        "🟢 Конвертирует",

      monitor:
        "⚪ Наблюдать",
    }[
      value
    ]
    ||
    "⚪ Наблюдать"
  );
}

function renderQueries() {

  const box =
    document.getElementById(
      "queryBody"
    );

  if (
    !box
  ) {
    return;
  }

  const data =
    DATA.search_queries
    || {};

  const rows =
    data.rows
    || [];

  const s =
    data.summary
    || {};

  if (
    !rows.length
  ) {

    box.innerHTML =
      moduleEmpty(
        "Search Query Intelligence недоступен или по запросам нет данных."
      );

    return;
  }

  box.innerHTML =
    kpiGrid([
      [
        "Реальных запросов",
        number(
          s.queries
        )
      ],
      [
        "Order",
        decimal(
          s.order_conversions
        )
      ],
      [
        "Вебинары",
        decimal(
          s.webinar_conversions
        )
      ],
      [
        "Опросы",
        decimal(
          s.survey_conversions
        )
      ],
    ])
    +
    `
      <div
        class="note"
        style="
          margin-bottom:12px;
        "
      >
        Кандидатов в минус:
        <strong>
          ${number(s.negative_candidates)}
        </strong>.

        Расход кандидатов:
        <strong>
          ${money(s.negative_candidate_spend)}
        </strong>.

        Новых ключей:
        <strong>
          ${number(s.new_keyword_candidates)}
        </strong>.
      </div>
    `
    +
    table(
      [
        "Запрос",
        "Сработавший ключ",
        "Тип",
        "Order",
        "CPA Order",
        "Вебинар",
        "Опрос",
        "Клики",
        "Расход",
        "Рекомендация",
      ],
      rows
        .slice(
          0,
          500
        )
        .map(
          x => `

            <tr>

              <td>
                <strong>
                  ${esc(x.query)}
                </strong>
              </td>

              <td>
                ${
                  esc(
                    x.criterion
                    ||
                    x.matched_keyword
                    ||
                    "—"
                  )
                }
              </td>

              <td>
                ${esc(x.match_type)}
              </td>

              <td>
                ${decimal(x.order_conversions)}
              </td>

              <td>
                ${
                  x.order_cpa
                    ? money(
                        x.order_cpa
                      )
                    : "—"
                }
              </td>

              <td>
                ${decimal(x.webinar_conversions)}
              </td>

              <td>
                ${decimal(x.survey_conversions)}
              </td>

              <td>
                ${number(x.clicks)}
              </td>

              <td>
                ${money(x.cost)}
              </td>

              <td>
                ${
                  esc(
                    queryRecommendation(
                      x.recommendation
                    )
                  )
                }
              </td>

            </tr>

          `
        )
        .join("")
    );
}

/* ============================== PLACEMENTS ============================== */

function placementStatus(
  status
) {

  return (
    {
      waste:
        "🔴 Расход без результата",

      bad_traffic:
        "🔴 Низкое качество",

      strong:
        "🟢 Сильная площадка",

      normal:
        "⚪ Норма",
    }[
      status
    ]
    ||
    "⚪ Норма"
  );
}

function renderPlacements() {

  const box =
    document.getElementById(
      "placementBody"
    );

  if (
    !box
  ) {
    return;
  }

  const data =
    DATA.placements
    || {};

  const rows =
    data.rows
    || [];

  const s =
    data.summary
    || {};

  if (
    !rows.length
  ) {

    box.innerHTML =
      moduleEmpty(
        "По площадкам РСЯ данных нет или модуль недоступен."
      );

    return;
  }

  box.innerHTML =
    kpiGrid([
      [
        "Площадок",
        number(
          s.placements
        )
      ],
      [
        "Order",
        decimal(
          s.order_conversions
        )
      ],
      [
        "Вебинары",
        decimal(
          s.webinar_conversions
        )
      ],
      [
        "Опросы",
        decimal(
          s.survey_conversions
        )
      ],
    ])
    +
    `
      <div
        class="note"
        style="
          margin-bottom:12px;
        "
      >
        На проверку:
        <strong>
          ${number(s.waste_candidates)}
        </strong>
        площадок,

        расход
        <strong>
          ${money(s.waste_candidate_spend)}
        </strong>.

        Сильные площадки определяются прежде всего по Order CPA.
      </div>
    `
    +
    table(
      [
        "Площадка",
        "Сеть",
        "Order",
        "CPA Order",
        "Вебинар",
        "Опрос",
        "Клики",
        "Расход",
        "Bounce",
        "Глубина",
        "Статус",
      ],
      rows
        .slice(
          0,
          500
        )
        .map(
          x => `

            <tr>

              <td>
                <strong>
                  ${esc(x.placement)}
                </strong>
              </td>

              <td>
                ${
                  esc(
                    x.external_network
                    ||
                    "—"
                  )
                }
              </td>

              <td>
                ${decimal(x.order_conversions)}
              </td>

              <td>
                ${
                  x.order_cpa
                    ? money(
                        x.order_cpa
                      )
                    : "—"
                }
              </td>

              <td>
                ${decimal(x.webinar_conversions)}
              </td>

              <td>
                ${decimal(x.survey_conversions)}
              </td>

              <td>
                ${number(x.clicks)}
              </td>

              <td>
                ${money(x.cost)}
              </td>

              <td>
                ${
                  x.sessions
                    ? pct(
                        x.bounce_rate
                      )
                    : "—"
                }
              </td>

              <td>
                ${
                  x.sessions
                    ? decimal(
                        x.avg_pageviews
                      )
                    : "—"
                }
              </td>

              <td>
                ${
                  esc(
                    placementStatus(
                      x.status
                    )
                  )
                }
              </td>

            </tr>

          `
        )
        .join("")
    );
}

/* ============================== AUDIENCE ============================== */

const AUDIENCE_LABELS = {

  age: {
    AGE_0_17:
      "0–17",

    AGE_18_24:
      "18–24",

    AGE_25_34:
      "25–34",

    AGE_35_44:
      "35–44",

    AGE_45_54:
      "45–54",

    AGE_55:
      "55+",

    UNKNOWN:
      "Не определён",
  },

  gender: {
    GENDER_MALE:
      "Мужчины",

    GENDER_FEMALE:
      "Женщины",

    UNKNOWN:
      "Не определён",
  },

  income_grade: {
    VERY_HIGH:
      "Топ 1%",

    HIGH:
      "Топ 2–5%",

    ABOVE_AVERAGE:
      "Топ 6–10%",

    OTHER:
      "Остальные 90%",

    UNKNOWN:
      "Не определён",
  },

  device: {
    DESKTOP:
      "Desktop",

    MOBILE:
      "Mobile",

    TABLET:
      "Tablet",

    SMART_TV:
      "Smart TV",

    UNKNOWN:
      "Не определён",
  },
};

function audienceValueLabel(
  field,
  value
) {

  return (
    AUDIENCE_LABELS[
      field
    ]?.[
      value
    ]
    ||
    value
    ||
    "Не определён"
  );
}

function audienceLabel(
  x
) {

  return [
    audienceValueLabel(
      "age",
      x.age
    ),
    audienceValueLabel(
      "gender",
      x.gender
    ),
    audienceValueLabel(
      "income_grade",
      x.income_grade
    ),
    audienceValueLabel(
      "device",
      x.device
    ),
  ]
    .join(
      " · "
    );
}

function audienceStatus(
  x
) {

  if (
    x.status
    === "opportunity"
  ) {

    return (
      "🟢 Потенциал"
    );
  }

  if (
    x.status
    === "expensive"
  ) {

    return (
      "🔴 Дорого"
    );
  }

  return (
    "⚪ Норма"
  );
}

function audienceFilterPass(
  row
) {

  for (
    const [
      field,
      selected
    ]
    of Object.entries(
      AUDIENCE_FILTERS
    )
  ) {

    if (
      selected.size
      &&
      !selected.has(
        String(
          row[field]
          || "UNKNOWN"
        )
      )
    ) {

      return false;
    }
  }

  return true;
}

function audienceFilterGroup(
  field,
  title,
  values
) {

  const selected =
    AUDIENCE_FILTERS[
      field
    ];

  return `

    <div
      style="
        padding:14px;
        border:1px solid #20354e;
        border-radius:12px;
        background:#0e1c2e;
      "
    >

      <div
        style="
          font-size:10px;
          color:#8ea2bb;
          margin-bottom:10px;
          text-transform:uppercase;
          letter-spacing:.06em;
        "
      >
        ${esc(title)}
      </div>

      <div
        style="
          display:flex;
          flex-wrap:wrap;
          gap:7px;
        "
      >

        ${
          values
            .map(
              value => {

                const active =
                  selected.has(
                    String(
                      value
                    )
                  );

                return `

                  <button
                    type="button"
                    data-audience-filter="${esc(field)}"
                    data-audience-value="${esc(value)}"
                    style="
                      border:1px solid ${
                        active
                          ? "#5aa7ff"
                          : "#20354e"
                      };
                      background:${
                        active
                          ? "#15385c"
                          : "#091525"
                      };
                      color:${
                        active
                          ? "#fff"
                          : "#a8bad0"
                      };
                      border-radius:999px;
                      padding:7px 10px;
                      cursor:pointer;
                      font-size:10px;
                    "
                  >
                    ${
                      esc(
                        audienceValueLabel(
                          field,
                          value
                        )
                      )
                    }
                  </button>

                `;
              }
            )
            .join("")
        }

      </div>

    </div>

  `;
}

function audienceMetricValue(
  row
) {

  return Number(
    row[
      AUDIENCE_METRIC
    ]
    || 0
  );
}

function pieData(
  rows,
  field
) {

  const map =
    new Map();

  for (
    const row
    of rows
  ) {

    const key =
      String(
        row[field]
        || "UNKNOWN"
      );

    map.set(
      key,
      (
        map.get(
          key
        )
        || 0
      )
      +
      audienceMetricValue(
        row
      )
    );
  }

  return [
    ...map.entries()
  ]
    .map(
      (
        [
          key,
          value
        ]
      ) => ({

        key,

        label:
          audienceValueLabel(
            field,
            key
          ),

        value,
      })
    )
    .filter(
      x =>
        x.value
        > 0
    )
    .sort(
      (
        a,
        b
      ) =>
        b.value
        -
        a.value
    );
}

function audienceMetricLabel() {

  return (
    {
      cost:
        "Расход",

      clicks:
        "Клики",

      order_conversions:
        "Order",

      webinar_conversions:
        "Вебинары",

      survey_conversions:
        "Опросы",
    }[
      AUDIENCE_METRIC
    ]
    ||
    AUDIENCE_METRIC
  );
}

function pieChart(
  title,
  field,
  data
) {

  if (
    !data.length
  ) {

    return `

      <div
        style="
          border:1px solid #20354e;
          border-radius:14px;
          padding:16px;
          background:#0e1c2e;
        "
      >

        <strong>
          ${esc(title)}
        </strong>

        <div
          style="
            color:#8ea2bb;
            font-size:11px;
            margin-top:12px;
          "
        >
          Нет данных для выбранной метрики.
        </div>

      </div>

    `;
  }

  const total =
    data.reduce(
      (
        sum,
        x
      ) =>
        sum
        +
        x.value,
      0
    );

  const colors = [
    "#5aa7ff",
    "#52d39a",
    "#ffb65c",
    "#9c86ff",
    "#ff6b72",
    "#55c0ff",
    "#c2d36f",
    "#d28cff",
  ];

  let cursor =
    0;

  const slices =
    data.map(
      (
        x,
        index
      ) => {

        const from =
          total
            ? cursor
              / total
              * 100
            : 0;

        cursor +=
          x.value;

        const to =
          total
            ? cursor
              / total
              * 100
            : 0;

        return `${
          colors[
            index
            %
            colors.length
          ]
        } ${from}% ${to}%`;
      }
    );

  return `

    <div
      style="
        border:1px solid #20354e;
        border-radius:14px;
        padding:16px;
        background:#0e1c2e;
        min-width:0;
      "
    >

      <strong>
        ${esc(title)}
      </strong>

      <div
        style="
          display:grid;
          grid-template-columns:150px 1fr;
          gap:18px;
          align-items:center;
          margin-top:15px;
        "
      >

        <div
          style="
            width:140px;
            height:140px;
            border-radius:50%;
            background:conic-gradient(${slices.join(",")});
            position:relative;
            margin:auto;
          "
        >

          <div
            style="
              position:absolute;
              inset:31px;
              border-radius:50%;
              background:#0e1c2e;
              display:grid;
              place-items:center;
              text-align:center;
              font-size:10px;
              color:#8ea2bb;
            "
          >
            ${esc(audienceMetricLabel())}
          </div>

        </div>

        <div
          style="
            display:grid;
            gap:8px;
            min-width:0;
          "
        >

          ${
            data
              .slice(
                0,
                8
              )
              .map(
                (
                  x,
                  index
                ) => {

                  const share =
                    total
                      ? x.value
                        / total
                        * 100
                      : 0;

                  return `

                    <div
                      style="
                        display:grid;
                        grid-template-columns:10px minmax(0,1fr) auto;
                        gap:7px;
                        align-items:center;
                        font-size:10px;
                      "
                    >

                      <span
                        style="
                          width:9px;
                          height:9px;
                          border-radius:50%;
                          background:${
                            colors[
                              index
                              %
                              colors.length
                            ]
                          };
                        "
                      ></span>

                      <span
                        style="
                          color:#b8c8d9;
                          overflow:hidden;
                          text-overflow:ellipsis;
                        "
                      >
                        ${esc(x.label)}
                      </span>

                      <strong>
                        ${share.toFixed(1)}%
                      </strong>

                    </div>

                  `;
                }
              )
              .join("")
          }

        </div>

      </div>

    </div>

  `;
}

function renderAudience() {

  const box =
    document.getElementById(
      "audienceBody"
    );

  if (
    !box
  ) {
    return;
  }

  const data =
    DATA.audience
    || {};

  const rows =
    data.rows
    || [];

  if (
    !rows.length
  ) {

    box.innerHTML =
      moduleEmpty(
        "По аудиториям данных нет или модуль недоступен."
      );

    return;
  }

  const values = {

    age:
      [
        ...new Set(
          rows.map(
            x =>
              String(
                x.age
                || "UNKNOWN"
              )
          )
        )
      ],

    gender:
      [
        ...new Set(
          rows.map(
            x =>
              String(
                x.gender
                || "UNKNOWN"
              )
          )
        )
      ],

    income_grade:
      [
        ...new Set(
          rows.map(
            x =>
              String(
                x.income_grade
                || "UNKNOWN"
              )
          )
        )
      ],

    device:
      [
        ...new Set(
          rows.map(
            x =>
              String(
                x.device
                || "UNKNOWN"
              )
          )
        )
      ],
  };

  const filtered =
    rows.filter(
      audienceFilterPass
    );

  const filteredCost =
    filtered.reduce(
      (
        sum,
        x
      ) =>
        sum
        +
        Number(
          x.cost
          || 0
        ),
      0
    );

  const filteredOrders =
    filtered.reduce(
      (
        sum,
        x
      ) =>
        sum
        +
        Number(
          x.order_conversions
          || 0
        ),
      0
    );

  const filteredWebinars =
    filtered.reduce(
      (
        sum,
        x
      ) =>
        sum
        +
        Number(
          x.webinar_conversions
          || 0
        ),
      0
    );

  const filteredSurveys =
    filtered.reduce(
      (
        sum,
        x
      ) =>
        sum
        +
        Number(
          x.survey_conversions
          || 0
        ),
      0
    );

  box.innerHTML = `

    ${
      kpiGrid([
        [
          "Сегментов после фильтра",
          number(
            filtered.length
          )
        ],
        [
          "Order",
          decimal(
            filteredOrders
          )
        ],
        [
          "Вебинары",
          decimal(
            filteredWebinars
          )
        ],
        [
          "Опросы",
          decimal(
            filteredSurveys
          )
        ],
      ])
    }

    <div
      style="
        display:flex;
        justify-content:space-between;
        align-items:center;
        gap:12px;
        flex-wrap:wrap;
        margin:0 0 12px;
      "
    >

      <div>

        <strong>
          Фильтры аудитории
        </strong>

        <div
          style="
            color:#8ea2bb;
            font-size:11px;
            margin-top:4px;
          "
        >
          Внутри одной характеристики можно выбрать несколько значений.
          Разные характеристики комбинируются между собой.
        </div>

      </div>

      <div
        style="
          display:flex;
          gap:8px;
          align-items:center;
        "
      >

        <select
          id="audienceMetricSelect"
          style="
            background:#0d1b2c;
            color:#dce7f2;
            border:1px solid #20354e;
            border-radius:9px;
            padding:9px 10px;
          "
        >

          <option
            value="cost"
            ${
              AUDIENCE_METRIC
              === "cost"
                ? "selected"
                : ""
            }
          >
            Диаграммы: расход
          </option>

          <option
            value="clicks"
            ${
              AUDIENCE_METRIC
              === "clicks"
                ? "selected"
                : ""
            }
          >
            Диаграммы: клики
          </option>

          <option
            value="order_conversions"
            ${
              AUDIENCE_METRIC
              === "order_conversions"
                ? "selected"
                : ""
            }
          >
            Диаграммы: Order
          </option>

          <option
            value="webinar_conversions"
            ${
              AUDIENCE_METRIC
              === "webinar_conversions"
                ? "selected"
                : ""
            }
          >
            Диаграммы: вебинары
          </option>

          <option
            value="survey_conversions"
            ${
              AUDIENCE_METRIC
              === "survey_conversions"
                ? "selected"
                : ""
            }
          >
            Диаграммы: опросы
          </option>

        </select>

        <button
          type="button"
          id="audienceResetFilters"
          class="ghost"
        >
          Сбросить
        </button>

      </div>

    </div>

    <div
      style="
        display:grid;
        grid-template-columns:repeat(auto-fit,minmax(260px,1fr));
        gap:10px;
        margin-bottom:16px;
      "
    >

      ${
        audienceFilterGroup(
          "age",
          "Возраст",
          values.age
        )
      }

      ${
        audienceFilterGroup(
          "gender",
          "Пол",
          values.gender
        )
      }

      ${
        audienceFilterGroup(
          "income_grade",
          "Платежеспособность",
          values.income_grade
        )
      }

      ${
        audienceFilterGroup(
          "device",
          "Устройство",
          values.device
        )
      }

    </div>

    <div
      style="
        display:grid;
        grid-template-columns:repeat(auto-fit,minmax(280px,1fr));
        gap:12px;
        margin-bottom:18px;
      "
    >

      ${
        pieChart(
          "Возраст",
          "age",
          pieData(
            filtered,
            "age"
          )
        )
      }

      ${
        pieChart(
          "Платежеспособность",
          "income_grade",
          pieData(
            filtered,
            "income_grade"
          )
        )
      }

      ${
        pieChart(
          "Устройства",
          "device",
          pieData(
            filtered,
            "device"
          )
        )
      }

    </div>

    <div
      class="note"
      style="
        margin-bottom:12px;
      "
    >
      Расход в текущем фильтре:
      <strong>
        ${money(filteredCost)}
      </strong>.

      Audience-рекомендации backend рассчитывает прежде всего по Order CPA.
    </div>

    ${
      table(
        [
          "Сегмент",
          "Order",
          "CPA Order",
          "Вебинар",
          "Опрос",
          "CPA опрос",
          "Клики",
          "Расход",
          "Статус",
          "Рекомендация",
        ],
        filtered
          .slice(
            0,
            500
          )
          .map(
            x => `

              <tr>

                <td>
                  <strong>
                    ${esc(audienceLabel(x))}
                  </strong>
                </td>

                <td>
                  ${decimal(x.order_conversions)}
                </td>

                <td>
                  ${
                    x.order_cpa
                      ? money(
                          x.order_cpa
                        )
                      : "—"
                  }
                </td>

                <td>
                  ${decimal(x.webinar_conversions)}
                </td>

                <td>
                  ${decimal(x.survey_conversions)}
                </td>

                <td>
                  ${
                    x.survey_cpa
                      ? money(
                          x.survey_cpa
                        )
                      : "—"
                  }
                </td>

                <td>
                  ${number(x.clicks)}
                </td>

                <td>
                  ${money(x.cost)}
                </td>

                <td>
                  ${esc(audienceStatus(x))}
                </td>

                <td>
                  ${esc(x.recommendation)}
                </td>

              </tr>

            `
          )
          .join("")
      )
    }

  `;
}

/* ============================== GEO ============================== */

function renderGeo() {

  const box =
    document.getElementById(
      "geoBody"
    );

  if (
    !box
  ) {
    return;
  }

  const data =
    DATA.geo
    || {};

  const rows =
    data.locations
    || [];

  const pairs =
    data.target_presence_pairs
    || [];

  const s =
    data.summary
    || {};

  if (
    !rows.length
  ) {

    box.innerHTML =
      moduleEmpty(
        "Географический разрез недоступен или пуст."
      );

    return;
  }

  const mismatch =
    pairs
      .filter(
        x =>
          x.differs_from_target
      )
      .slice(
        0,
        50
      );

  box.innerHTML =
    kpiGrid([
      [
        "Фактических регионов",
        number(
          s.actual_locations
        )
      ],
      [
        "Order",
        decimal(
          s.order_conversions
        )
      ],
      [
        "Вебинары",
        decimal(
          s.webinar_conversions
        )
      ],
      [
        "Опросы",
        decimal(
          s.survey_conversions
        )
      ],
    ])
    +
    `
      <div
        class="note"
        style="
          margin-bottom:12px;
        "
      >
        Отличие фактического региона от таргетинга не означает ошибку автоматически.

        Расход по отличающимся парам:
        <strong>
          ${money(s.different_target_spend)}
        </strong>

        (${pct(s.different_target_share)}).
      </div>
    `
    +
    table(
      [
        "Фактический регион",
        "Order",
        "CPA Order",
        "Вебинар",
        "Опрос",
        "CPA опрос",
        "Клики",
        "CTR",
        "Расход",
      ],
      rows
        .slice(
          0,
          200
        )
        .map(
          x => `

            <tr>

              <td>
                <strong>
                  ${esc(x.location)}
                </strong>
              </td>

              <td>
                ${decimal(x.order_conversions)}
              </td>

              <td>
                ${
                  x.order_cpa
                    ? money(
                        x.order_cpa
                      )
                    : "—"
                }
              </td>

              <td>
                ${decimal(x.webinar_conversions)}
              </td>

              <td>
                ${decimal(x.survey_conversions)}
              </td>

              <td>
                ${
                  x.survey_cpa
                    ? money(
                        x.survey_cpa
                      )
                    : "—"
                }
              </td>

              <td>
                ${number(x.clicks)}
              </td>

              <td>
                ${pct(x.ctr)}
              </td>

              <td>
                ${money(x.cost)}
              </td>

            </tr>

          `
        )
        .join("")
    )
    +
    (
      mismatch.length

        ? `

          <div
            class="section-head"
          >

            <div>

              <h3>
                Фактический регион отличается от таргетинга
              </h3>

            </div>

          </div>

          ${
            table(
              [
                "Таргетинг",
                "Фактическое местоположение",
                "Order",
                "Вебинар",
                "Опрос",
                "Расход",
              ],
              mismatch
                .map(
                  x => `

                    <tr>

                      <td>
                        ${esc(x.targeting_location)}
                      </td>

                      <td>
                        ${esc(x.presence_location)}
                      </td>

                      <td>
                        ${decimal(x.order_conversions)}
                      </td>

                      <td>
                        ${decimal(x.webinar_conversions)}
                      </td>

                      <td>
                        ${decimal(x.survey_conversions)}
                      </td>

                      <td>
                        ${money(x.cost)}
                      </td>

                    </tr>

                  `
                )
                .join("")
            )
          }

        `

        : ""
    );
}

/* ============================== POSITIONS ============================== */

function slotLabel(
  value
) {

  return (
    {
      PREMIUMBLOCK:
        "Премиум-показы",

      OTHER:
        "Остальные показы",

      COMMERCIAL_SEARCH:
        "Коммерческий поиск",

      ALONE:
        "Эксклюзивное размещение",

      SUGGEST:
        "Поисковые подсказки",

      PRODUCT_GALLERY:
        "Товарная галерея",
    }[
      value
    ]
    ||
    value
    ||
    "—"
  );
}

function renderPositions() {

  const box =
    document.getElementById(
      "positionBody"
    );

  if (
    !box
  ) {
    return;
  }

  const data =
    DATA.positions
    || {};

  const rows =
    data.rows
    || [];

  const s =
    data.summary
    || {};

  if (
    !rows.length
  ) {

    box.innerHTML =
      moduleEmpty(
        "По поисковым позициям данных нет или модуль недоступен."
      );

    return;
  }

  box.innerHTML =
    kpiGrid([
      [
        "Строк анализа",
        number(
          s.rows
        )
      ],
      [
        "Order",
        decimal(
          s.order_conversions
        )
      ],
      [
        "Вебинары",
        decimal(
          s.webinar_conversions
        )
      ],
      [
        "Опросы",
        decimal(
          s.survey_conversions
        )
      ],
    ])
    +
    `
      <div
        class="note"
        style="
          margin-bottom:12px;
        "
      >
        Расход при AvgTrafficVolume ≥ 80:

        <strong>
          ${money(s.high_traffic_volume_spend)}
        </strong>

        (${pct(s.high_traffic_volume_share)}).
      </div>
    `
    +
    table(
      [
        "Кампания",
        "Блок",
        "Traffic Volume",
        "Ср. ставка",
        "CPC",
        "Order",
        "CPA Order",
        "Вебинар",
        "Опрос",
        "Расход",
      ],
      rows
        .slice(
          0,
          500
        )
        .map(
          x => `

            <tr>

              <td>
                <strong>
                  ${esc(x.campaign_name)}
                </strong>
              </td>

              <td>
                ${esc(slotLabel(x.slot))}
              </td>

              <td>
                ${decimal(x.avg_traffic_volume)}
              </td>

              <td>
                ${
                  x.avg_effective_bid
                    ? money(
                        x.avg_effective_bid
                      )
                    : "—"
                }
              </td>

              <td>
                ${
                  x.cpc
                    ? money(
                        x.cpc
                      )
                    : "—"
                }
              </td>

              <td>
                ${decimal(x.order_conversions)}
              </td>

              <td>
                ${
                  x.order_cpa
                    ? money(
                        x.order_cpa
                      )
                    : "—"
                }
              </td>

              <td>
                ${decimal(x.webinar_conversions)}
              </td>

              <td>
                ${decimal(x.survey_conversions)}
              </td>

              <td>
                ${money(x.cost)}
              </td>

            </tr>

          `
        )
        .join("")
    );
}

/* ============================== NAV / EVENTS ============================== */

const TITLES = {

  overview: [
    "Обзор рекламы",
    "Сводка и автоматические сигналы из нескольких разрезов Yandex Direct API.",
  ],

  alerts: [
    "Аномалии",
    "События и потери, которые требуют ручной проверки.",
  ],

  budget: [
    "Budget Optimizer",
    "Анализ расходов и трёх типов конверсий.",
  ],

  creatives: [
    "Creative Intelligence",
    "Какие именно визуалы работают лучше остальных.",
  ],

  keywords: [
    "Ключевые фразы",
    "Order, вебинары и опросы по рекламной семантике.",
  ],

  queries: [
    "Search Query Intelligence",
    "Реальные запросы пользователей и рекомендации по семантике.",
  ],

  placements: [
    "Placement Intelligence",
    "Качество и результативность площадок РСЯ.",
  ],

  audience: [
    "Audience Intelligence",
    "Фильтры возраста, пола, платежеспособности и устройства.",
  ],

  geo: [
    "Geo Intelligence",
    "Фактическое местоположение пользователей против таргетинга.",
  ],

  positions: [
    "Search Position Economics",
    "Цена и эффективность поисковых размещений.",
  ],
};

function showSection(
  id
) {

  document
    .querySelectorAll(
      ".section"
    )
    .forEach(
      s => {

        s.classList.remove(
          "active"
        );
      }
    );

  document
    .querySelectorAll(
      ".nav"
    )
    .forEach(
      b => {

        b.classList.toggle(
          "active",
          b.dataset.section
          === id
        );
      }
    );

  document
    .getElementById(
      id
    )
    ?.classList.add(
      "active"
    );

  const title =
    TITLES[
      id
    ];

  if (
    title
  ) {

    const h =
      document.getElementById(
        "pageTitle"
      );

    const p =
      document.getElementById(
        "pageSubtitle"
      );

    if (
      h
    ) {

      h.textContent =
        title[0];
    }

    if (
      p
    ) {

      p.textContent =
        title[1];
    }
  }
}

document.addEventListener(
  "click",
  e => {

    const nav =
      e.target.closest(
        ".nav[data-section]"
      );

    if (
      nav
    ) {

      showSection(
        nav.dataset.section
      );

      return;
    }

    const goto =
      e.target.closest(
        "[data-goto]"
      );

    if (
      goto
    ) {

      showSection(
        goto.dataset.goto
      );

      return;
    }

    const filter =
      e.target.closest(
        "#alertFilters [data-filter]"
      );

    if (
      filter
    ) {

      ALERT_FILTER =
        filter.dataset.filter
        || "all";

      renderAlerts();

      return;
    }

    const audienceFilter =
      e.target.closest(
        "[data-audience-filter][data-audience-value]"
      );

    if (
      audienceFilter
    ) {

      const field =
        audienceFilter
          .dataset
          .audienceFilter;

      const value =
        audienceFilter
          .dataset
          .audienceValue;

      const set =
        AUDIENCE_FILTERS[
          field
        ];

      if (
        set
      ) {

        if (
          set.has(
            value
          )
        ) {

          set.delete(
            value
          );

        } else {

          set.add(
            value
          );
        }

        renderAudience();
      }

      return;
    }

    if (
      e.target.closest(
        "#audienceResetFilters"
      )
    ) {

      Object.values(
        AUDIENCE_FILTERS
      )
        .forEach(
          set =>
            set.clear()
        );

      renderAudience();
    }
  }
);

document.addEventListener(
  "change",
  e => {

    if (
      e.target
      ?.id
      === "audienceMetricSelect"
    ) {

      AUDIENCE_METRIC =
        e.target.value
        || "cost";

      renderAudience();
    }
  }
);

document
  .getElementById(
    "periodSelect"
  )
  ?.addEventListener(
    "change",
    () => {

      if (
        !DATA
      ) {
        return;
      }

      renderOverview();

      renderAlerts();

      renderBudget();
    }
  );

document
  .getElementById(
    "refreshBtn"
  )
  ?.addEventListener(
    "click",
    async e => {

      const password =
        sessionStorage.getItem(
          "marketingRadarPassword"
        );

      if (
        !password
      ) {
        return;
      }

      const button =
        e.currentTarget;

      const old =
        button.textContent;

      button.disabled =
        true;

      button.textContent =
        "Обновляем...";

      try {

        DATA =
          await loadEncryptedReport(
            password
          );

        render();

      } catch (error) {

        console.error(
          error
        );

        alert(
          "Не удалось обновить данные."
        );

      } finally {

        button.disabled =
          false;

        button.textContent =
          old;
      }
    }
  );

/* ============================== UTIL ============================== */

function formatDate(
  value
) {

  if (
    !value
  ) {
    return "—";
  }

  return new Date(
    value
  ).toLocaleString(
    "ru-RU"
  );
}

/* ============================== START ============================== */

start();
