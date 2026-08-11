let DATA = null;
let ALERT_FILTER = "all";
let KEYWORD_SUBTAB = "performance";
let SEARCH_INSIGHT_TAB = "queries";
let CREATIVE_ATTRIBUTION_FILTER = "all";
let CREATIVE_TYPE_FILTER = "all";
let CREATIVE_NETWORK_FILTER = "all";
let CREATIVE_SEARCH = "";
let OVERVIEW_TAB = "summary";
let ORDER_OVERVIEW_CAMPAIGN = "all";

const GLOBAL_CAMPAIGN_FILTER = new Set();
let CAMPAIGN_FILTER_OPEN = false;

let PLACEMENT_SORT = "cost";
let PLACEMENT_SORT_DIR = "desc";

const PLACEMENT_FILTERS = {
  campaign: "all",
  placement: "",
  network: "all",
  minOrder: "",
  maxOrderCpa: "",
  minWebinar: "",
  minSurvey: "",
  minClicks: "",
  minCost: "",
  maxBounce: "",
  minDepth: "",
  status: "all",
};

const GEO_FILTERS = {
  location: "",
  minCost: "",
  conversionType: "all",
  onlyWithConversions: false,
};

let GEO_METRIC = "cost";

const POSITION_FILTERS = {
  campaign: "all",
  slot: "all",
  minClicks: "",
  minOrder: "",
  minCost: "",
};

let POSITION_METRIC = "cost";

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
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
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
    { name: "AES-GCM", iv: base64ToBytes(payload.nonce) },
    key,
    base64ToBytes(payload.ciphertext)
  );
  return JSON.parse(new TextDecoder().decode(plaintext));
}

async function loadEncryptedReport(password) {
  const response = await fetch(`data/report.enc?t=${Date.now()}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return decryptPayload(await response.json(), password);
}

/* ============================== LOGIN ============================== */

function showLogin() {
  document.body.insertAdjacentHTML("beforeend", `
    <div id="loginOverlay" style="position:fixed;inset:0;z-index:99999;background:#07111f;display:flex;align-items:center;justify-content:center;padding:24px">
      <div style="width:100%;max-width:400px;padding:32px;border:1px solid #20354e;border-radius:18px;background:#0e1c2e">
        <div style="font-size:11px;letter-spacing:.12em;color:#5aa7ff;margin-bottom:10px">MARKETING RADAR</div>
        <h2>Доступ к аналитике</h2>
        <p style="color:#8ea2bb;font-size:13px">Введите пароль для расшифровки данных.</p>
        <input id="reportPassword" type="password" placeholder="Пароль"
          style="width:100%;padding:13px;border-radius:9px;border:1px solid #20354e;background:#091525;color:white;margin-top:10px">
        <div id="loginError" style="min-height:18px;color:#ff6b72;font-size:11px;margin-top:8px"></div>
        <button id="loginButton"
          style="width:100%;padding:13px;border:0;border-radius:9px;background:#3e9df8;color:white;font-weight:600;cursor:pointer;margin-top:8px">
          Войти
        </button>
      </div>
    </div>
  `);

  const input = document.getElementById("reportPassword");
  const button = document.getElementById("loginButton");

  async function login() {
    if (!input.value) return;
    button.disabled = true;
    button.textContent = "Расшифровка...";
    try {
      DATA = await loadEncryptedReport(input.value);
      sessionStorage.setItem("marketingRadarPassword", input.value);
      document.getElementById("loginOverlay")?.remove();
      render();
    } catch (error) {
      console.error(error);
      document.getElementById("loginError").textContent =
        "Неверный пароль или не удалось загрузить отчёт.";
      button.disabled = false;
      button.textContent = "Войти";
    }
  }

  button.addEventListener("click", login);
  input.addEventListener("keydown", e => {
    if (e.key === "Enter") login();
  });
  input.focus();
}

async function start() {
  const password = sessionStorage.getItem("marketingRadarPassword");
  if (password) {
    try {
      DATA = await loadEncryptedReport(password);
      render();
      return;
    } catch (error) {
      console.error(error);
      sessionStorage.removeItem("marketingRadarPassword");
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
  ["auction", "Аукцион API"],
  ["delivery", "Диагностика показов"],
  ["changes", "Изменения API"],
  ["configaudit", "Configuration Audit"],
];

const REMOVED_SECTIONS = [
  "attribution",
  "goals",
  "media",
  "retargeting",
  "prioritygoals",
];

function ensureAdvancedUI() {
  const nav = document.querySelector(".sidebar nav");

  // Удаляем старые пункты, если они остались в HTML/DOM
  // от предыдущей версии.
  for (const id of REMOVED_SECTIONS) {
    nav?.querySelector(
      `[data-section="${id}"]`
    )?.remove();

    document.getElementById(id)?.remove();
  }

  if (nav) {
    nav.style.overflowY = "auto";
    nav.style.paddingRight = "3px";

    for (const [id, label] of ADVANCED_SECTIONS) {
      if (!nav.querySelector(`[data-section="${id}"]`)) {
        const button = document.createElement("button");
        button.className = "nav";
        button.dataset.section = id;
        button.textContent = label;
        nav.appendChild(button);
      }
    }
  }

  const main = document.querySelector("main");
  const footer = document.querySelector("main footer");

  if (!main) return;

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

    auction: [
      "Auction Intelligence",
      "Текущий аукцион по фразам: вход в поиск, цена премиум-показов, конкуренция и изменение цены.",
      "auctionBody",
    ],

    delivery: [
      "Delivery Diagnostics",
      "Есть ли поисковый спрос на ключ, но нет фактических показов: API-only диагностика hasSearchVolume.",
      "deliveryBody",
    ],

    changes: [
      "Change Intelligence",
      "Какие кампании и дочерние объекты менялись, и где Яндекс пересчитал статистику.",
      "changesBody",
    ],

    configaudit: [
      "Configuration Audit",
      "Фактические BidModifiers и проверка направления корректировок против эффективности сегментов.",
      "configAuditBody",
    ],
  };

  for (const [id, [title, copy, bodyId]] of Object.entries(definitions)) {
    if (document.getElementById(id)) continue;

    const section = document.createElement("section");
    section.id = id;
    section.className = "section";
    section.innerHTML = `
      <div class="section-head top">
        <div>
          <h2>${esc(title)}</h2>
          <p>${esc(copy)}</p>
        </div>
      </div>
      <div id="${bodyId}"></div>
    `;

    if (footer) {
      footer.parentNode.insertBefore(section, footer);
    } else {
      main.appendChild(section);
    }
  }
}

function prepareStaticCopy() {
  const campaignTitle = document.querySelector("#overview .split .panel:first-child .panel-head h3");
  const campaignCopy = document.querySelector("#overview .split .panel:first-child .panel-head p");
  const budgetCopy = document.querySelector("#overview .split .panel:nth-child(2) .panel-head p");
  const attentionTitle = document.querySelector("#overview .section-head h3");
  const attentionCopy = document.querySelector("#overview .section-head p");

  if (campaignTitle) campaignTitle.textContent = "Показатели кампаний";
  if (campaignCopy) campaignCopy.textContent = "Расход, клики, CTR, CPC и раздельные конверсии: Order / вебинары / опросы.";
  if (budgetCopy) budgetCopy.textContent = "Сводка по расходам и эффективности рекламы. Денежные показатели Reports API — без НДС.";
  if (attentionTitle) attentionTitle.textContent = "Что требует внимания";
  if (attentionCopy) attentionCopy.textContent =
    "Сигналы строятся из нескольких разрезов API, а не только из таблицы кампаний.";

  const creativeTitle = document.querySelector("#creatives h2");
  const creativeCopy = document.querySelector("#creatives .section-head p");
  if (creativeTitle) creativeTitle.textContent = "Creative Intelligence";
  if (creativeCopy) creativeCopy.textContent = "Какие именно картинки и видео работают лучше.";
}


/* ============================== GLOBAL CAMPAIGN FILTER ============================== */

function campaignCatalog() {
  const map = new Map();

  function add(id, name) {
    id = String(id || "");

    if (!id) {
      return;
    }

    if (!map.has(id)) {
      map.set(
        id,
        name || `Кампания ${id}`
      );
    }
  }

  for (const x of DATA?.campaigns || []) {
    add(
      x.campaign_id,
      x.name || x.campaign_name
    );
  }

  const collections = [
    DATA?.keywords || [],
    DATA?.search_queries?.rows || [],
    DATA?.placements?.rows || [],
    DATA?.audience?.rows || [],
    DATA?.geo?.locations || [],
    DATA?.positions?.rows || [],
    DATA?.auction_intelligence?.rows || [],
    DATA?.delivery_diagnostics?.rows || [],
    DATA?.change_intelligence?.rows || [],
    DATA?.configuration_audit?.rows || [],
    DATA?.creatives || [],
  ];

  for (const rows of collections) {
    for (const x of rows) {
      add(
        x.campaign_id,
        x.campaign_name
      );

      const ids =
        x.campaign_ids || [];

      const names =
        x.campaign_names || [];

      ids.forEach(
        (id, index) =>
          add(
            id,
            names[index]
          )
      );
    }
  }

  return [...map.entries()]
    .map(
      ([id, name]) => ({
        id,
        name,
      })
    )
    .sort(
      (a, b) =>
        a.name.localeCompare(
          b.name,
          "ru"
        )
    );
}

function rowCampaignIds(row) {
  const ids = new Set();

  if (
    row?.campaign_id !== undefined
    && row?.campaign_id !== null
    && String(row.campaign_id)
  ) {
    ids.add(
      String(
        row.campaign_id
      )
    );
  }

  for (
    const id
    of (
      row?.campaign_ids
      || []
    )
  ) {
    if (
      id !== undefined
      && id !== null
      && String(id)
    ) {
      ids.add(
        String(id)
      );
    }
  }

  return [...ids];
}

function campaignPass(row) {
  if (
    GLOBAL_CAMPAIGN_FILTER.size === 0
  ) {
    return true;
  }

  const ids =
    rowCampaignIds(row);

  if (ids.length) {
    return ids.some(
      id =>
        GLOBAL_CAMPAIGN_FILTER.has(
          id
        )
    );
  }

  // Some creative objects only contain campaign_name.
  const campaignName =
    String(
      row?.campaign_name
      || ""
    );

  if (campaignName) {
    const selectedNames =
      new Set(
        campaignCatalog()
          .filter(
            x =>
              GLOBAL_CAMPAIGN_FILTER.has(
                x.id
              )
          )
          .map(
            x => x.name
          )
      );

    return selectedNames.has(
      campaignName
    );
  }

  return true;
}

function selectedCampaignLabel() {
  if (
    GLOBAL_CAMPAIGN_FILTER.size === 0
  ) {
    return "Все кампании";
  }

  const selected =
    campaignCatalog()
      .filter(
        x =>
          GLOBAL_CAMPAIGN_FILTER.has(
            x.id
          )
      );

  if (
    selected.length === 1
  ) {
    return selected[0].name;
  }

  return `Выбрано: ${selected.length}`;
}

function ensureCampaignFilterUI() {
  const actions =
    document.querySelector(
      ".header-actions"
    );

  if (!actions) {
    return;
  }

  let host =
    document.getElementById(
      "globalCampaignFilter"
    );

  if (!host) {
    host =
      document.createElement(
        "div"
      );

    host.id =
      "globalCampaignFilter";

    host.style.cssText = `
      position:relative;
      order:-1;
      z-index:4000;
    `;

    actions.prepend(
      host
    );
  }

  const catalog =
    campaignCatalog();

  host.innerHTML = `
    <button
      type="button"
      id="campaignFilterToggle"
      style="
        min-width:210px;
        max-width:340px;
        text-align:left;
        border:1px solid #20354e;
        background:#0e1c2e;
        color:#dce7f2;
        border-radius:10px;
        padding:9px 12px;
        cursor:pointer;
      "
    >
      <span style="
        display:block;
        font-size:9px;
        color:#7891aa;
        text-transform:uppercase;
        letter-spacing:.06em;
      ">
        Кампании
      </span>

      <strong style="
        display:block;
        margin-top:3px;
        white-space:nowrap;
        overflow:hidden;
        text-overflow:ellipsis;
      ">
        ${esc(selectedCampaignLabel())}
      </strong>
    </button>

    ${
      CAMPAIGN_FILTER_OPEN
        ? `
          <div style="
            position:absolute;
            right:0;
            top:calc(100% + 8px);
            width:min(520px,88vw);
            max-height:520px;
            overflow:auto;
            border:1px solid #20354e;
            border-radius:12px;
            background:#0b1829;
            padding:12px;
            box-shadow:0 20px 60px rgba(0,0,0,.4);
          ">
            <div style="
              display:flex;
              gap:8px;
              margin-bottom:10px;
            ">
              <button
                type="button"
                data-campaign-action="all"
                class="ghost"
              >
                Все кампании
              </button>
            </div>

            <div style="
              display:grid;
              gap:5px;
            ">
              ${
                catalog
                  .map(
                    c => `
                      <label style="
                        display:grid;
                        grid-template-columns:18px minmax(0,1fr);
                        gap:8px;
                        align-items:center;
                        padding:8px;
                        border-radius:8px;
                        background:#0e1c2e;
                        cursor:pointer;
                      ">
                        <input
                          type="checkbox"
                          data-global-campaign-id="${esc(c.id)}"
                          ${
                            GLOBAL_CAMPAIGN_FILTER.size === 0
                            || GLOBAL_CAMPAIGN_FILTER.has(c.id)
                              ? "checked"
                              : ""
                          }
                        >

                        <span style="
                          overflow:hidden;
                          text-overflow:ellipsis;
                        ">
                          ${esc(c.name)}
                        </span>
                      </label>
                    `
                  )
                  .join("")
              }
            </div>
          </div>
        `
        : ""
    }
  `;
}

function rerenderAnalytics() {
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
  renderAuction();
  renderDelivery();
  renderChanges();
  renderConfigurationAudit();
  ensureCampaignFilterUI();
}

/* ============================== OVERVIEW TABS ============================== */

function ensureOverviewTabs() {
  const overview =
    document.getElementById(
      "overview"
    );

  if (!overview) {
    return;
  }

  let tabs =
    document.getElementById(
      "overviewTabs"
    );

  if (!tabs) {
    tabs =
      document.createElement(
        "div"
      );

    tabs.id =
      "overviewTabs";

    tabs.style.cssText = `
      display:flex;
      gap:8px;
      margin-bottom:14px;
    `;

    overview.prepend(
      tabs
    );
  }

  tabs.innerHTML = `
    <button
      type="button"
      data-overview-tab="summary"
      style="
        border:1px solid ${
          OVERVIEW_TAB === "summary"
            ? "#5aa7ff"
            : "#20354e"
        };
        background:${
          OVERVIEW_TAB === "summary"
            ? "#15385c"
            : "#0d1b2c"
        };
        color:${
          OVERVIEW_TAB === "summary"
            ? "#fff"
            : "#9db1c8"
        };
        border-radius:9px;
        padding:9px 13px;
        cursor:pointer;
      "
    >
      Сводка
    </button>

    <button
      type="button"
      data-overview-tab="orders"
      style="
        border:1px solid ${
          OVERVIEW_TAB === "orders"
            ? "#5aa7ff"
            : "#20354e"
        };
        background:${
          OVERVIEW_TAB === "orders"
            ? "#15385c"
            : "#0d1b2c"
        };
        color:${
          OVERVIEW_TAB === "orders"
            ? "#fff"
            : "#9db1c8"
        };
        border-radius:9px;
        padding:9px 13px;
        cursor:pointer;
      "
    >
      Order Intelligence
    </button>
  `;

  let orderPanel =
    document.getElementById(
      "overviewOrderPanel"
    );

  if (!orderPanel) {
    orderPanel =
      document.createElement(
        "div"
      );

    orderPanel.id =
      "overviewOrderPanel";

    tabs.after(
      orderPanel
    );
  }

  const summaryElements = [
    overview.querySelector(
      ":scope > .hero"
    ),
    document.getElementById(
      "kpis"
    ),
    overview.querySelector(
      ":scope > .section-head"
    ),
    document.getElementById(
      "priorityAlerts"
    ),
    overview.querySelector(
      ":scope > .split"
    ),
  ];

  for (const element of summaryElements) {
    if (!element) {
      continue;
    }

    element.style.display =
      OVERVIEW_TAB === "summary"
        ? ""
        : "none";
  }

  orderPanel.style.display =
    OVERVIEW_TAB === "orders"
      ? ""
      : "none";
}

function orderGoalCatalog() {
  return (
    DATA?.meta?.order_goal_catalog
    || {}
  );
}

function orderOverviewSnapshot() {
  const days =
    selectedDays();

  const rows =
    Array.isArray(
      DATA.daily
    )
      ? DATA.daily
      : [];

  const dates =
    rows
      .map(
        x => x.date
      )
      .filter(Boolean)
      .sort();

  if (!dates.length) {
    return {
      days,
      campaigns: [],
      goalTotals: {},
      totalOrders: 0,
      spend: 0,
      clicks: 0,
    };
  }

  const latest =
    new Date(
      `${dates.at(-1)}T00:00:00Z`
    );

  const start =
    new Date(
      latest
    );

  start.setUTCDate(
    start.getUTCDate()
    - days
    + 1
  );

  const campaignMap =
    new Map();

  const goalTotals = {};
  let spend = 0;
  let clicks = 0;

  for (const row of rows) {
    if (!row.date) {
      continue;
    }

    const date =
      new Date(
        `${row.date}T00:00:00Z`
      );

    if (
      date < start
      || date > latest
    ) {
      continue;
    }

    const campaignId =
      String(
        row.campaign_id
        || ""
      );

    if (
      GLOBAL_CAMPAIGN_FILTER.size
      && !GLOBAL_CAMPAIGN_FILTER.has(
        campaignId
      )
    ) {
      continue;
    }

    if (
      ORDER_OVERVIEW_CAMPAIGN !== "all"
      && campaignId
      !== ORDER_OVERVIEW_CAMPAIGN
    ) {
      continue;
    }

    if (
      !campaignMap.has(
        campaignId
      )
    ) {
      campaignMap.set(
        campaignId,
        {
          campaign_id:
            campaignId,

          campaign_name:
            row.campaign_name
            || "Без названия",

          spend: 0,
          clicks: 0,
          order_conversions: 0,
          order_goal_conversions: {},
        }
      );
    }

    const item =
      campaignMap.get(
        campaignId
      );

    item.spend +=
      Number(
        row.cost
        || 0
      );

    item.clicks +=
      Number(
        row.clicks
        || 0
      );

    item.order_conversions +=
      Number(
        row.order_conversions
        || 0
      );

    spend +=
      Number(
        row.cost
        || 0
      );

    clicks +=
      Number(
        row.clicks
        || 0
      );

    const goals =
      row.order_goal_conversions
      || {};

    for (
      const [goalId, value]
      of Object.entries(
        goals
      )
    ) {
      const numeric =
        Number(
          value
          || 0
        );

      item.order_goal_conversions[
        goalId
      ] =
        Number(
          item.order_goal_conversions[
            goalId
          ]
          || 0
        )
        + numeric;

      goalTotals[
        goalId
      ] =
        Number(
          goalTotals[
            goalId
          ]
          || 0
        )
        + numeric;
    }
  }

  const campaigns =
    [...campaignMap.values()]
      .sort(
        (a, b) =>
          b.order_conversions
          - a.order_conversions
          || b.spend
          - a.spend
      );

  const totalOrders =
    Object.values(
      goalTotals
    ).reduce(
      (sum, value) =>
        sum
        + Number(
          value
          || 0
        ),
      0
    );

  return {
    days,
    campaigns,
    goalTotals,
    totalOrders,
    spend,
    clicks,
  };
}

function renderOverviewOrders() {
  const box =
    document.getElementById(
      "overviewOrderPanel"
    );

  if (!box) {
    return;
  }

  const snap =
    orderOverviewSnapshot();

  const catalog =
    orderGoalCatalog();

  const availableCampaigns =
    campaignCatalog()
      .filter(
        c =>
          GLOBAL_CAMPAIGN_FILTER.size === 0
          || GLOBAL_CAMPAIGN_FILTER.has(
            c.id
          )
      );

  const goalEntries =
    Object.entries(
      catalog
    );

  const sortedGoals =
    goalEntries
      .map(
        ([id, name]) => ({
          id,
          name,
          value:
            Number(
              snap.goalTotals[id]
              || 0
            ),
        })
      )
      .sort(
        (a, b) =>
          b.value
          - a.value
      );

  const topGoal =
    sortedGoals[0];

  const donutData =
    sortedGoals
      .filter(
        x => x.value > 0
      )
      .map(
        x => ({
          label: x.name,
          value: x.value,
        })
      );

  box.innerHTML = `
    <div style="
      display:flex;
      gap:10px;
      align-items:center;
      flex-wrap:wrap;
      margin-bottom:14px;
    ">
      <select
        id="orderOverviewCampaign"
        style="
          min-width:260px;
          background:#0d1b2c;
          color:#dce7f2;
          border:1px solid #20354e;
          border-radius:9px;
          padding:10px 11px;
        "
      >
        <option value="all">
          Все выбранные кампании
        </option>

        ${
          availableCampaigns
            .map(
              c => `
                <option
                  value="${esc(c.id)}"
                  ${
                    ORDER_OVERVIEW_CAMPAIGN === c.id
                      ? "selected"
                      : ""
                  }
                >
                  ${esc(c.name)}
                </option>
              `
            )
            .join("")
        }
      </select>

      <span style="
        color:#8ea2bb;
        font-size:10px;
      ">
        Период: ${snap.days} дней · суммы без НДС
      </span>
    </div>

    ${
      kpiGrid([
        [
          "Всего Order",
          decimal(
            snap.totalOrders
          )
        ],
        [
          "CPA Order",
          snap.totalOrders > 0
            ? money(
                snap.spend
                / snap.totalOrders
              )
            : "—"
        ],
        [
          "Кампаний с Order",
          number(
            snap.campaigns.filter(
              x =>
                x.order_conversions > 0
            ).length
          )
        ],
        [
          "Главная Order-цель",
          topGoal?.value > 0
            ? `${topGoal.name}: ${decimal(topGoal.value)}`
            : "—"
        ],
      ])
    }

    <div style="
      display:grid;
      grid-template-columns:minmax(300px,520px) minmax(0,1fr);
      gap:14px;
      margin:16px 0;
    ">
      ${
        genericDonut(
          "Какие Order приходят",
          donutData,
          "Order"
        )
      }

      <div style="
        border:1px solid #20354e;
        border-radius:14px;
        padding:16px;
        background:#0e1c2e;
      ">
        <strong>
          Разбивка по целям
        </strong>

        <div style="
          display:grid;
          gap:8px;
          margin-top:13px;
        ">
          ${
            sortedGoals
              .map(
                goal => `
                  <div style="
                    display:grid;
                    grid-template-columns:minmax(0,1fr) auto;
                    gap:10px;
                    padding:8px 0;
                    border-bottom:1px solid #1d3047;
                  ">
                    <span>
                      ${esc(goal.name)}
                    </span>

                    <strong>
                      ${decimal(goal.value)}
                    </strong>
                  </div>
                `
              )
              .join("")
          }
        </div>
      </div>
    </div>

    ${
      table(
        [
          "Кампания",
          ...goalEntries.map(
            ([, name]) =>
              name
          ),
          "Всего Order",
          "CPA Order",
          "Расход",
        ],
        snap.campaigns
          .map(
            campaign => `
              <tr>
                <td>
                  <strong>
                    ${esc(campaign.campaign_name)}
                  </strong>
                </td>

                ${
                  goalEntries
                    .map(
                      ([goalId]) => `
                        <td>
                          ${decimal(
                            campaign.order_goal_conversions[
                              goalId
                            ]
                          )}
                        </td>
                      `
                    )
                    .join("")
                }

                <td>
                  <strong>
                    ${decimal(campaign.order_conversions)}
                  </strong>
                </td>

                <td>
                  ${
                    campaign.order_conversions > 0
                      ? money(
                          campaign.spend
                          / campaign.order_conversions
                        )
                      : "—"
                  }
                </td>

                <td>
                  ${money(campaign.spend)}
                </td>
              </tr>
            `
          )
          .join("")
      )
    }
  `;
}

/* ============================== RENDER ============================== */

function render() {
  if (!DATA) return;

  ensureAdvancedUI();
  ensureCampaignFilterUI();
  ensureOverviewTabs();
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

  // API-only modules.
  // В v10 функции существовали ниже в файле, но render()
  // их не вызывал, поэтому вкладки создавались пустыми.
  renderAuction();
  renderDelivery();
  renderChanges();
  renderConfigurationAudit();
}

function renderMeta() {
  const updated = formatDate(DATA.meta?.updated_at);
  const sidebar = document.getElementById("sidebarUpdated");
  const footer = document.getElementById("footerUpdated");
  if (sidebar) sidebar.textContent = updated;
  if (footer) footer.textContent = `Обновлено ${updated}`;
}


/* ============================== CONVERSIONS ============================== */

function conversionBreakdown(x = {}) {
  const order = Number(x.order_conversions || 0);
  const webinar = Number(x.webinar_conversions || 0);
  const survey = Number(x.survey_conversions || 0);

  return {
    order,
    webinar,
    survey,
    total: order + webinar + survey,
  };
}

function cpa(cost, conversions) {
  cost = Number(cost || 0);
  conversions = Number(conversions || 0);

  return conversions > 0
    ? cost / conversions
    : 0;
}

function conversionMiniRows(x) {
  const c = conversionBreakdown(x);

  return [
    ["Order", decimal(c.order)],
    ["Вебинар", decimal(c.webinar)],
    ["Опрос", decimal(c.survey)],
  ];
}

/* ============================== PERIOD / OVERVIEW ============================== */

function selectedDays() {
  return Math.max(1, Number(document.getElementById("periodSelect")?.value || 30));
}

function finalCampaign(c) {
  const impressions = Number(c.impressions || 0);
  const clicks = Number(c.clicks || 0);
  const spend = Number(c.spend ?? c.cost ?? 0);

  const order_conversions = Number(
    c.order_conversions || 0
  );
  const webinar_conversions = Number(
    c.webinar_conversions || 0
  );
  const survey_conversions = Number(
    c.survey_conversions || 0
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
        ? clicks / impressions * 100
        : 0,

    avg_cpc:
      clicks
        ? spend / clicks
        : 0,

    order_cr:
      clicks
        ? order_conversions / clicks * 100
        : 0,

    webinar_cr:
      clicks
        ? webinar_conversions / clicks * 100
        : 0,

    survey_cr:
      clicks
        ? survey_conversions / clicks * 100
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

function summarizeCampaigns(campaigns) {
  const s = campaigns.reduce(
    (a, c) => {
      a.impressions += Number(c.impressions || 0);
      a.clicks += Number(c.clicks || 0);
      a.spend += Number(c.spend || 0);
      a.order_conversions += Number(c.order_conversions || 0);
      a.webinar_conversions += Number(c.webinar_conversions || 0);
      a.survey_conversions += Number(c.survey_conversions || 0);
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
      ? s.clicks / s.impressions * 100
      : 0;

  s.avg_cpc =
    s.clicks
      ? s.spend / s.clicks
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
  const days = selectedDays();

  const rows = Array.isArray(DATA.daily)
    ? DATA.daily
    : [];

  if (!rows.length) {
    const campaigns = (DATA.campaigns || [])
      .filter(campaignPass)
      .map(finalCampaign)
      .sort((a, b) => b.spend - a.spend);

    return {
      days,
      campaigns,
      summary: summarizeCampaigns(campaigns),
    };
  }

  const dates = rows
    .map(r => r.date)
    .filter(Boolean)
    .sort();

  if (!dates.length) {
    const campaigns = (DATA.campaigns || [])
      .filter(campaignPass)
      .map(finalCampaign)
      .sort((a, b) => b.spend - a.spend);

    return {
      days,
      campaigns,
      summary: summarizeCampaigns(campaigns),
    };
  }

  const latest =
    new Date(`${dates.at(-1)}T00:00:00Z`);

  const start =
    new Date(latest);

  start.setUTCDate(
    start.getUTCDate()
    - days
    + 1
  );

  const map = new Map();

  for (const row of rows) {
    if (!row.date) continue;

    const d =
      new Date(`${row.date}T00:00:00Z`);

    if (
      d < start
      || d > latest
    ) {
      continue;
    }

    const id =
      String(row.campaign_id || "");

    if (!id) continue;

    if (
      GLOBAL_CAMPAIGN_FILTER.size
      && !GLOBAL_CAMPAIGN_FILTER.has(id)
    ) {
      continue;
    }

    if (!map.has(id)) {
      map.set(id, {
        campaign_id: id,
        name:
          row.campaign_name
          || "Без названия",
        impressions: 0,
        clicks: 0,
        spend: 0,
        order_conversions: 0,
        webinar_conversions: 0,
        survey_conversions: 0,
      });
    }

    const item = map.get(id);

    item.impressions +=
      Number(row.impressions || 0);

    item.clicks +=
      Number(row.clicks || 0);

    item.spend +=
      Number(row.cost || 0);

    item.order_conversions +=
      Number(row.order_conversions || 0);

    item.webinar_conversions +=
      Number(row.webinar_conversions || 0);

    item.survey_conversions +=
      Number(row.survey_conversions || 0);
  }

  const campaigns =
    [...map.values()]
      .map(finalCampaign)
      .sort(
        (a, b) =>
          b.spend - a.spend
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
  const snap = overviewSnapshot();
  const s = snap.summary;

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

  if (heroHeadline) {
    heroHeadline.textContent =
      "Marketing Radar работает";
  }

  if (heroCopy) {
    heroCopy.textContent =
      `${number(snap.campaigns.length)} кампаний · `
      + `${money(s.spend)} расходов · `
      + `${number(s.clicks)} кликов · `
      + `Order ${decimal(s.order_conversions)} · `
      + `Вебинары ${decimal(s.webinar_conversions)} · `
      + `Опросы ${decimal(s.survey_conversions)}`;
  }

  if (health) {
    health.textContent = "LIVE";
  }

  const kpis =
    document.getElementById(
      "kpis"
    );

  if (kpis) {
    const items = [
      ["Расход", money(s.spend)],
      ["Показы", number(s.impressions)],
      ["Клики", number(s.clicks)],
      ["CTR", pct(s.ctr)],
    ];

    kpis.innerHTML =
      items
        .map(
          ([label, value]) => `
            <div class="kpi">
              <div class="label">
                ${esc(label)}
              </div>
              <div class="value">
                ${esc(value)}
              </div>
              <div class="delta neutral">
                за ${snap.days} дней
              </div>
            </div>
          `
        )
        .join("");
  }

  renderCampaignTable(snap);
  renderOverviewSummary(snap);
  renderPriorityInsights(snap);
  ensureOverviewTabs();
  renderOverviewOrders();
}

function renderCampaignTable(snap) {
  const box =
    document.getElementById(
      "campaignTable"
    );

  if (!box) return;

  box.innerHTML = `
    <div style="overflow:auto">
      <table class="table">
        <thead>
          <tr>
            <th>Кампания</th>
            <th>Расход</th>
            <th>Клики</th>
            <th>CTR</th>
            <th>CPC</th>
            <th>Order</th>
            <th>CPA Order</th>
            <th>Вебинар</th>
            <th>Опрос</th>
            <th>CPA опрос</th>
          </tr>
        </thead>
        <tbody>
          ${
            snap.campaigns
              .map(
                c => `
                  <tr>
                    <td>
                      <strong>${esc(c.name)}</strong>
                    </td>
                    <td>${money(c.spend)}</td>
                    <td>${number(c.clicks)}</td>
                    <td>${pct(c.ctr)}</td>
                    <td>
                      ${c.avg_cpc ? money(c.avg_cpc) : "—"}
                    </td>
                    <td>${decimal(c.order_conversions)}</td>
                    <td>
                      ${c.order_cpa ? money(c.order_cpa) : "—"}
                    </td>
                    <td>${decimal(c.webinar_conversions)}</td>
                    <td>${decimal(c.survey_conversions)}</td>
                    <td>
                      ${c.survey_cpa ? money(c.survey_cpa) : "—"}
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

function renderOverviewSummary(snap) {
  const box =
    document.getElementById(
      "budgetPreview"
    );

  if (!box) return;

  const s = snap.summary;

  const rows = [
    [
      "Средний CPC",
      "По аккаунту",
      s.avg_cpc
        ? money(s.avg_cpc)
        : "—",
    ],
    [
      "Order",
      `За ${snap.days} дней`,
      decimal(s.order_conversions),
    ],
    [
      "CPA Order",
      "Цена выполнения Order",
      s.order_cpa
        ? money(s.order_cpa)
        : "—",
    ],
    [
      "Регистрации на вебинары/митапы",
      "ID целей пока не добавлены",
      decimal(s.webinar_conversions),
    ],
    [
      "Прохождения опросов",
      "BHT + White Paper AXE",
      decimal(s.survey_conversions),
    ],
    [
      "CPA опроса",
      "Цена прохождения опроса",
      s.survey_cpa
        ? money(s.survey_cpa)
        : "—",
    ],
  ];

  box.innerHTML =
    rows
      .map(
        r => `
          <div class="budget-item">
            <div>
              <strong>${esc(r[0])}</strong>
              <small>${esc(r[1])}</small>
            </div>
            <strong>${esc(r[2])}</strong>
          </div>
        `
      )
      .join("");
}

function advancedSignals() {
  const radarRows =
    DATA.radar?.signals
    || [];

  const selected =
    radarRows.filter(
      x => {
        // Radar signal can be account-level. It remains visible,
        // while row-level pages are filtered by selected campaigns.
        return true;
      }
    );

  if (selected.length) {
    return selected.map(
      x => ({
        severity:
          x.severity
          || "warning",

        label:
          ({
            search_gap: "SEARCH GAP",
            placement_waste: "РСЯ",
            configuration_conflict: "CONFIG",
            budget_saturation: "BUDGET",
            budget_scalable: "SCALE",
            creative_master: "CREATIVE",
          })[
            x.type
          ]
          || "RADAR",

        title:
          x.title
          || "",

        text:
          `${
            x.value !== undefined
              ? `${x.value} ${x.metric || ""}. `
              : ""
          }${
            x.details || ""
          }`,

        goto:
          x.goto
          || null,
      })
    );
  }

  return [];
}

function renderPriorityInsights(snap) {
  const box = document.getElementById("priorityAlerts");
  if (!box) return;

  const signals = advancedSignals();
  if (!signals.length) {
    const c = snap.campaigns;
    const s = snap.summary;
    if (c[0]) {
      signals.push({
        severity: "warning",
        label: "РАСХОД",
        title: c[0].name,
        text: `${money(c[0].spend)} — максимальный расход среди кампаний.`,
      });
    }
    const highCpc = c.filter(x => x.clicks >= 5).sort((a, b) => b.avg_cpc - a.avg_cpc)[0];
    if (highCpc) {
      signals.push({
        severity: "warning",
        label: "CPC",
        title: highCpc.name,
        text: `CPC ${money(highCpc.avg_cpc)} при среднем ${s.avg_cpc ? money(s.avg_cpc) : "—"}.`,
      });
    }
    const bestCtr = c.filter(x => x.clicks >= 10).sort((a, b) => b.ctr - a.ctr)[0];
    if (bestCtr) {
      signals.push({
        severity: "opportunity",
        label: "CTR",
        title: bestCtr.name,
        text: `Лучший CTR: ${pct(bestCtr.ctr)}.`,
      });
    }
  }

  box.innerHTML = signals.slice(0, 3).map(x => `
    <article class="alert-card ${x.severity}">
      <div class="severity">${esc(x.label)}</div>
      <h4>${esc(x.title)}</h4>
      <p>${esc(x.text)}</p>
    </article>
  `).join("");
}

/* ============================== ALERTS ============================== */

function buildAlerts() {
  const snap = overviewSnapshot();
  const s = snap.summary;
  const alerts = [];

  for (const c of snap.campaigns) {
    if (c.conversions === 0 && c.clicks >= 20 && c.spend >= 1000) {
      alerts.push({
        severity: "critical", label: "Критично",
        title: "Расход без конверсий",
        text: `${c.name}: ${money(c.spend)}, ${number(c.clicks)} кликов, 0 конверсий.`,
        meta: `CTR ${pct(c.ctr)}`,
      });
    }
    if (s.avg_cpc && c.avg_cpc > s.avg_cpc * 1.4 && c.clicks >= 5) {
      alerts.push({
        severity: "warning", label: "Внимание",
        title: "CPC выше среднего",
        text: `${c.name}: CPC ${money(c.avg_cpc)} против ${money(s.avg_cpc)} в среднем.`,
        meta: `${number(c.clicks)} кликов`,
      });
    }
  }

  for (const signal of advancedSignals()) {
    alerts.push({
      severity: signal.severity,
      label: signal.severity === "critical" ? "Критично" :
             signal.severity === "opportunity" ? "Возможность" : "Внимание",
      title: signal.title,
      text: signal.text,
      meta: signal.label,
    });
  }

  return alerts;
}

function renderAlerts() {
  const box = document.getElementById("allAlerts");
  if (!box) return;

  const alerts = buildAlerts();
  const badge = document.getElementById("navAlertCount");
  if (badge) badge.textContent = number(alerts.length);

  document.querySelectorAll("#alertFilters [data-filter]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.filter === ALERT_FILTER);
  });

  const filtered = ALERT_FILTER === "all"
    ? alerts
    : alerts.filter(x => x.severity === ALERT_FILTER);

  box.innerHTML = filtered.length ? filtered.map(x => `
    <article class="alert-row ${x.severity}">
      <div class="severity">${esc(x.label)}</div>
      <div><h4>${esc(x.title)}</h4><p>${esc(x.text)}</p></div>
      <div class="meta">${esc(x.meta || "")}</div>
    </article>
  `).join("") : `<div class="note">По выбранному фильтру сигналов нет.</div>`;
}

/* ============================== BUDGET ============================== */

function budgetSaturationLabel(value) {
  return ({
    saturated:
      "🔴 Есть признаки насыщения",

    scalable:
      "🟢 Потенциал масштабирования",

    neutral:
      "⚪ Без явного сигнала",

    insufficient_data:
      "⚪ Мало данных",
  })[value]
  || value
  || "—";
}

function renderBudget() {
  const box =
    document.getElementById(
      "budgetTable"
    );

  if (!box) return;

  const snap =
    overviewSnapshot();

  const s =
    snap.summary;

  const saturationRows =
    (
      DATA.budget_saturation?.rows
      || []
    )
      .filter(campaignPass);

  function rec(c) {
    if (
      c.conversions === 0
      && c.clicks >= 20
    ) {
      return "Проверить: расход без отслеживаемых конверсий";
    }

    if (
      c.order_cpa
      && s.order_cpa
      && c.order_cpa
      < s.order_cpa * 0.8
    ) {
      return "Order CPA ниже baseline выбранных кампаний";
    }

    if (
      s.avg_cpc
      && c.avg_cpc
      > s.avg_cpc * 1.3
    ) {
      return "Проверить высокий CPC";
    }

    return "Без явного сигнала";
  }

  box.innerHTML = `
    ${
      table(
        [
          "Кампания",
          "Расход",
          "Доля",
          "CPC",
          "Order",
          "CPA Order",
          "Вебинар",
          "Опрос",
          "CPA опрос",
          "Сигнал",
        ],
        snap.campaigns
          .map(
            c => `
              <tr>
                <td>
                  <strong>${esc(c.name)}</strong>
                </td>

                <td>${money(c.spend)}</td>

                <td>
                  ${
                    s.spend
                      ? (
                          c.spend
                          / s.spend
                          * 100
                        ).toFixed(1)
                      : "0.0"
                  }%
                </td>

                <td>
                  ${c.avg_cpc ? money(c.avg_cpc) : "—"}
                </td>

                <td>${decimal(c.order_conversions)}</td>

                <td>
                  ${c.order_cpa ? money(c.order_cpa) : "—"}
                </td>

                <td>${decimal(c.webinar_conversions)}</td>

                <td>${decimal(c.survey_conversions)}</td>

                <td>
                  ${c.survey_cpa ? money(c.survey_cpa) : "—"}
                </td>

                <td>${esc(rec(c))}</td>
              </tr>
            `
          )
          .join("")
      )
    }

    <div class="section-head" style="margin-top:22px">
      <div>
        <h3>Marginal CPA / насыщение бюджета</h3>
        <p>
          Сравнение Order CPA на квартилях дневного расхода.
          Это диагностический сигнал, а не причинный эксперимент.
        </p>
      </div>
    </div>

    ${
      saturationRows.length
        ? table(
            [
              "Кампания",
              "Статус",
              "Дней",
              "Q75 дневного расхода",
              "Общий CPA Order",
              "CPA при высоком расходе",
              "CPA выше среднего",
              "Изменение",
            ],
            saturationRows
              .map(
                row => {
                  const high =
                    (row.buckets || [])
                      .find(
                        x =>
                          x.id === "high"
                      );

                  const mid =
                    (row.buckets || [])
                      .find(
                        x =>
                          x.id === "mid_high"
                      );

                  return `
                    <tr>
                      <td>
                        <strong>${esc(row.campaign_name)}</strong>
                      </td>

                      <td>
                        ${esc(budgetSaturationLabel(row.status))}
                      </td>

                      <td>${number(row.active_days)}</td>

                      <td>
                        ${row.q75_spend ? money(row.q75_spend) : "—"}
                      </td>

                      <td>
                        ${row.overall_order_cpa ? money(row.overall_order_cpa) : "—"}
                      </td>

                      <td>
                        ${high?.order_cpa ? money(high.order_cpa) : "—"}
                      </td>

                      <td>
                        ${mid?.order_cpa ? money(mid.order_cpa) : "—"}
                      </td>

                      <td>
                        ${
                          row.saturation_ratio
                            ? `${((row.saturation_ratio - 1) * 100).toFixed(0)}%`
                            : "—"
                        }
                      </td>
                    </tr>
                  `;
                }
              )
              .join("")
          )
        : moduleEmpty(
            "Для выбранных кампаний недостаточно данных для оценки насыщения."
          )
    }
  `;
}



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
        "Нет asset-level статистики"
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

function creativeAttributionLabel(
  value
) {
  return (
    {
      exact:
        "EXACT · отдельный визуальный ad",

      proxy:
        "SINGLE-ASSET · один визуал в объявлении",

      unattributable:
        "MULTI-ASSET · Direct не делит статистику",
    }[
      value
    ]
    ||
    value
    ||
    "—"
  );
}

function creativeAttributionLabel(value) {
  return ({
    exact: "EXACT",
    proxy: "SINGLE-ASSET",
    shared_proxy: "MULTI-ASSET",
    unattributable: "NO STATS",
  })[value]
  || value
  || "—";
}

function renderCreatives() {
  const box =
    document.getElementById(
      "creativeGrid"
    );

  if (!box) return;

  const master =
    DATA.creative_master
    || {};

  const masterRows =
    master.available
      ? (
          master.rows
          || []
        )
      : [];

  if (masterRows.length) {
    let rows =
      masterRows.filter(
        row => {
          if (
            GLOBAL_CAMPAIGN_FILTER.size
          ) {
            const selectedNames =
              new Set(
                campaignCatalog()
                  .filter(
                    c =>
                      GLOBAL_CAMPAIGN_FILTER.has(
                        c.id
                      )
                  )
                  .map(
                    c => c.name
                  )
              );

            if (
              row.campaign_name
              && !selectedNames.has(
                row.campaign_name
              )
            ) {
              return false;
            }
          }

          if (
            CREATIVE_SEARCH
            && ![
              row.image_name,
              row.video_id,
              row.campaign_name,
            ]
              .join(" ")
              .toLowerCase()
              .includes(
                CREATIVE_SEARCH
                  .toLowerCase()
              )
          ) {
            return false;
          }

          return true;
        }
      );

    rows.sort(
      (a, b) =>
        Number(b.cost || 0)
        - Number(a.cost || 0)
    );

    box.innerHTML = `
      <div class="note" style="
        margin-bottom:14px;
        border-color:#245b49;
      ">
        🟢 Используется точный element-level экспорт Мастера отчётов:
        <strong>${esc(master.source || "CSV/TSV")}</strong>.
        Здесь статистика относится к конкретному изображению / видео,
        а не ко всему объявлению.
      </div>

      ${
        kpiGrid([
          ["Элементов", number(rows.length)],
          [
            "Расход",
            money(
              rows.reduce(
                (sum, x) =>
                  sum + Number(x.cost || 0),
                0
              )
            )
          ],
          [
            "Клики",
            number(
              rows.reduce(
                (sum, x) =>
                  sum + Number(x.clicks || 0),
                0
              )
            )
          ],
          [
            "Order",
            decimal(
              rows.reduce(
                (sum, x) =>
                  sum + Number(x.order_conversions || 0),
                0
              )
            )
          ],
        ])
      }

      <div style="
        display:flex;
        gap:8px;
        flex-wrap:wrap;
        margin-bottom:14px;
      ">
        <input
          id="creativeSearch"
          value="${esc(CREATIVE_SEARCH)}"
          placeholder="Название изображения / ID видео…"
          style="
            min-width:260px;
            background:#091525;
            color:#dce7f2;
            border:1px solid #20354e;
            border-radius:8px;
            padding:9px 10px;
          "
        >
      </div>

      ${
        table(
          [
            "Элемент",
            "Кампания",
            "Показы",
            "Клики",
            "CTR",
            "Расход",
            "CPC",
            "Order",
            "CPA Order",
          ],
          rows
            .map(
              row => {
                const label =
                  row.image_name
                  || (
                    row.video_id
                      ? `Видео ${row.video_id}`
                      : "Видео"
                  );

                return `
                  <tr>
                    <td>
                      <strong>${esc(label)}</strong>
                    </td>

                    <td>${esc(row.campaign_name || "—")}</td>

                    <td>${number(row.impressions)}</td>

                    <td>${number(row.clicks)}</td>

                    <td>${pct(row.ctr)}</td>

                    <td>${money(row.cost)}</td>

                    <td>
                      ${row.avg_cpc ? money(row.avg_cpc) : "—"}
                    </td>

                    <td>${decimal(row.order_conversions)}</td>

                    <td>
                      ${
                        row.order_conversions > 0
                          ? money(
                              row.cost
                              / row.order_conversions
                            )
                          : "—"
                      }
                    </td>
                  </tr>
                `;
              }
            )
            .join("")
        )
      }
    `;

    return;
  }

  const allRows =
    (DATA.creatives || [])
      .filter(campaignPass);

  const placementCampaigns =
    [...new Map(
      allRows
        .filter(
          x =>
            String(
              x.campaign_id
              || ""
            )
        )
        .map(
          x => [
            String(
              x.campaign_id
            ),
            x.campaign_name
            || `Кампания ${x.campaign_id}`,
          ]
        )
    ).entries()]
      .sort(
        (a, b) =>
          String(a[1])
            .localeCompare(
              String(b[1]),
              "ru"
            )
      );

  if (
    PLACEMENT_FILTERS.campaign !== "all"
    && !placementCampaigns.some(
      ([id]) =>
        id
        === PLACEMENT_FILTERS.campaign
    )
  ) {
    PLACEMENT_FILTERS.campaign = "all";
  }

  const networks =
    [...new Set(
      allRows
        .map(
          x =>
            String(
              x.network || ""
            )
        )
        .filter(Boolean)
    )]
      .sort();

  const kinds =
    [...new Set(
      allRows
        .map(
          x =>
            String(
              x.kind
              || x.asset_type
              || ""
            )
        )
        .filter(Boolean)
    )]
      .sort();

  const rows =
    allRows
      .filter(
        c => {
          if (
            CREATIVE_ATTRIBUTION_FILTER !== "all"
            && c.attribution
            !== CREATIVE_ATTRIBUTION_FILTER
          ) {
            return false;
          }

          if (
            CREATIVE_TYPE_FILTER !== "all"
            && String(
              c.kind
              || c.asset_type
              || ""
            )
            !== CREATIVE_TYPE_FILTER
          ) {
            return false;
          }

          if (
            CREATIVE_NETWORK_FILTER !== "all"
            && String(
              c.network || ""
            )
            !== CREATIVE_NETWORK_FILTER
          ) {
            return false;
          }

          if (
            CREATIVE_SEARCH
            && ![
              c.name,
              c.asset_id,
              c.campaign_name,
            ]
              .join(" ")
              .toLowerCase()
              .includes(
                CREATIVE_SEARCH
                  .toLowerCase()
              )
          ) {
            return false;
          }

          return true;
        }
      )
      .sort(
        (a, b) =>
          Number(b.spend || 0)
          - Number(a.spend || 0)
      );

  box.innerHTML = `
    <div class="note" style="margin-bottom:14px">
      Публичный Reports API пока не отдаёт группировки
      «Изображение / Название изображения / ID видео / Превью видео»,
      которые есть в новом Мастере отчётов.
      Поэтому для multi-asset объявлений сайт не приписывает
      общую статистику каждой картинке.

      <br><br>

      Чтобы получить точный Creative Lab, положите CSV/TSV экспорт
      Мастера отчётов в
      <strong>data/creative_master_report.csv</strong>.
      update_data.py автоматически подхватит его при следующем запуске.
    </div>

    <div style="
      display:flex;
      gap:8px;
      flex-wrap:wrap;
      margin-bottom:14px;
    ">
      <input
        id="creativeSearch"
        value="${esc(CREATIVE_SEARCH)}"
        placeholder="Название / ID…"
        style="
          min-width:220px;
          background:#091525;
          color:#dce7f2;
          border:1px solid #20354e;
          border-radius:8px;
          padding:9px 10px;
        "
      >

      <select
        id="creativeTypeSelect"
      >
        <option value="all">Все типы</option>
        ${
          kinds
            .map(
              value => `
                <option
                  value="${esc(value)}"
                  ${
                    CREATIVE_TYPE_FILTER === value
                      ? "selected"
                      : ""
                  }
                >
                  ${esc(value)}
                </option>
              `
            )
            .join("")
        }
      </select>

      <select
        id="creativeNetworkSelect"
      >
        <option value="all">Все сети</option>
        ${
          networks
            .map(
              value => `
                <option
                  value="${esc(value)}"
                  ${
                    CREATIVE_NETWORK_FILTER === value
                      ? "selected"
                      : ""
                  }
                >
                  ${esc(value)}
                </option>
              `
            )
            .join("")
        }
      </select>

      <select
        id="creativeAttributionSelect"
      >
        <option value="all">Все</option>
        <option value="exact" ${
          CREATIVE_ATTRIBUTION_FILTER === "exact"
            ? "selected"
            : ""
        }>EXACT</option>
        <option value="proxy" ${
          CREATIVE_ATTRIBUTION_FILTER === "proxy"
            ? "selected"
            : ""
        }>SINGLE-ASSET</option>
        <option value="shared_proxy" ${
          CREATIVE_ATTRIBUTION_FILTER === "shared_proxy"
            ? "selected"
            : ""
        }>MULTI-ASSET</option>
      </select>
    </div>

    ${
      table(
        [
          "Креатив",
          "Кампания",
          "Тип",
          "Точность",
          "Показы",
          "Клики",
          "CTR",
          "Расход",
          "Order",
        ],
        rows
          .map(
            c => {
              const usable =
                c.attribution === "exact"
                || c.attribution === "proxy";

              return `
                <tr>
                  <td>
                    <strong>
                      ${esc(c.name || c.asset_id || "—")}
                    </strong>
                  </td>

                  <td>${esc(c.campaign_name || "—")}</td>

                  <td>${esc(c.kind || c.asset_type || "—")}</td>

                  <td>
                    ${esc(creativeAttributionLabel(c.attribution))}
                  </td>

                  <td>
                    ${usable ? number(c.impressions) : "—"}
                  </td>

                  <td>
                    ${usable ? number(c.clicks) : "—"}
                  </td>

                  <td>
                    ${usable ? pct(c.ctr) : "—"}
                  </td>

                  <td>
                    ${usable ? money(c.spend) : "—"}
                  </td>

                  <td>
                    ${usable ? decimal(c.order_conversions) : "—"}
                  </td>
                </tr>
              `;
            }
          )
          .join("")
    )}
  `;
}



function mini(label, value) {
  return `<div class="mini"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
}
function pill(text) {
  return `<span style="padding:5px 8px;border-radius:7px;background:#0a1726;font-size:9px">${esc(text)}</span>`;
}

/* ============================== GENERIC HELPERS ============================== */

function moduleEmpty(message) {
  return `<div class="note">${esc(message)}</div>`;
}

function kpiGrid(items) {
  return `
    <div class="kpi-grid">
      ${items.map(([label, value, note]) => `
        <div class="kpi">
          <div class="label">${esc(label)}</div>
          <div class="value">${esc(value)}</div>
          <div class="delta neutral">${esc(note || `за ${DATA.meta?.period_days || 60} дней`)}</div>
        </div>
      `).join("")}
    </div>
  `;
}

function table(headers, rowsHtml) {
  return `
    <div class="panel">
      <div style="overflow:auto">
        <table class="table">
          <thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
    </div>
  `;
}


function genericDonutData(
  rows,
  keyGetter,
  valueGetter,
  maxItems = 8
) {
  const map = new Map();

  for (const row of rows) {
    const key =
      String(
        keyGetter(row)
        || "Не определено"
      );

    const value =
      Number(
        valueGetter(row)
        || 0
      );

    map.set(
      key,
      (map.get(key) || 0)
      + value
    );
  }

  const sorted =
    [...map.entries()]
      .map(
        ([label, value]) => ({
          label,
          value,
        })
      )
      .filter(
        x => x.value > 0
      )
      .sort(
        (a, b) =>
          b.value - a.value
      );

  if (
    sorted.length
    <= maxItems
  ) {
    return sorted;
  }

  const head =
    sorted.slice(
      0,
      maxItems
    );

  const other =
    sorted
      .slice(maxItems)
      .reduce(
        (sum, x) =>
          sum + x.value,
        0
      );

  if (other > 0) {
    head.push({
      label: "Остальные",
      value: other,
    });
  }

  return head;
}

function genericDonut(
  title,
  data,
  centerLabel
) {
  if (!data.length) {
    return `
      <div style="
        border:1px solid #20354e;
        border-radius:14px;
        padding:16px;
        background:#0e1c2e;
      ">
        <strong>${esc(title)}</strong>
        <div style="
          margin-top:12px;
          color:#8ea2bb;
          font-size:11px;
        ">
          Нет данных для выбранной метрики.
        </div>
      </div>
    `;
  }

  const total =
    data.reduce(
      (sum, item) =>
        sum + item.value,
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
    "#5bd6c7",
  ];

  let cursor = 0;

  const slices =
    data.map(
      (item, index) => {
        const from =
          total
            ? cursor / total * 100
            : 0;

        cursor += item.value;

        const to =
          total
            ? cursor / total * 100
            : 0;

        return `${
          colors[
            index % colors.length
          ]
        } ${from}% ${to}%`;
      }
    );

  return `
    <div style="
      border:1px solid #20354e;
      border-radius:14px;
      padding:16px;
      background:#0e1c2e;
      min-width:0;
    ">
      <strong>${esc(title)}</strong>

      <div style="
        display:grid;
        grid-template-columns:160px 1fr;
        gap:18px;
        align-items:center;
        margin-top:16px;
      ">
        <div style="
          width:150px;
          height:150px;
          border-radius:50%;
          background:conic-gradient(${slices.join(",")});
          position:relative;
          margin:auto;
        ">
          <div style="
            position:absolute;
            inset:34px;
            border-radius:50%;
            background:#0e1c2e;
            display:grid;
            place-items:center;
            text-align:center;
            padding:8px;
            color:#8ea2bb;
            font-size:10px;
          ">
            ${esc(centerLabel)}
          </div>
        </div>

        <div style="
          display:grid;
          gap:8px;
          min-width:0;
        ">
          ${
            data
              .map(
                (item, index) => {
                  const share =
                    total
                      ? item.value / total * 100
                      : 0;

                  return `
                    <div style="
                      display:grid;
                      grid-template-columns:10px minmax(0,1fr) auto;
                      gap:7px;
                      align-items:center;
                      font-size:10px;
                    ">
                      <span style="
                        width:9px;
                        height:9px;
                        border-radius:50%;
                        background:${
                          colors[
                            index % colors.length
                          ]
                        };
                      "></span>

                      <span style="
                        color:#b8c8d9;
                        overflow:hidden;
                        text-overflow:ellipsis;
                      ">
                        ${esc(item.label)}
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

/* ============================== KEYWORDS ============================== */

function keywordServingLabel(value) {
  return ({
    ELIGIBLE: "🟢 Показы возможны",
    RARELY_SERVED: "🟡 RARELY_SERVED",
    UNKNOWN: "⚪ Не определено",
  })[value]
  || value
  || "—";
}

function keywordStateLabel(value) {
  return ({
    ON: "🟢 ON",
    SUSPENDED: "🟡 SUSPENDED",
    OFF: "🔴 OFF",
  })[value]
  || value
  || "—";
}

function keywordModerationLabel(value) {
  return ({
    ACCEPTED: "🟢 ACCEPTED",
    DRAFT: "🟡 DRAFT",
    REJECTED: "🔴 REJECTED",
    UNKNOWN: "⚪ UNKNOWN",
  })[value]
  || value
  || "—";
}

function keywordTabs() {
  const tabs = [
    ["performance", "Эффективность"],
    ["statuses", "Статусы ключей"],
    ["negatives", "Минус-фразы кампании"],
  ];

  return `
    <div style="
      display:flex;
      gap:8px;
      flex-wrap:wrap;
      margin-bottom:16px;
    ">
      ${
        tabs
          .map(
            ([id, label]) => `
              <button
                type="button"
                data-keyword-tab="${id}"
                style="
                  border:1px solid ${
                    KEYWORD_SUBTAB === id
                      ? "#5aa7ff"
                      : "#20354e"
                  };
                  background:${
                    KEYWORD_SUBTAB === id
                      ? "#15385c"
                      : "#0d1b2c"
                  };
                  color:${
                    KEYWORD_SUBTAB === id
                      ? "#fff"
                      : "#9db1c8"
                  };
                  border-radius:9px;
                  padding:9px 12px;
                  cursor:pointer;
                "
              >
                ${esc(label)}
              </button>
            `
          )
          .join("")
      }
    </div>
  `;
}

function renderKeywordPerformance(rows, summary) {
  rows.sort(
    (a, b) =>
      Number(b.order_conversions || 0)
      - Number(a.order_conversions || 0)
      || Number(b.survey_conversions || 0)
      - Number(a.survey_conversions || 0)
      || Number(b.clicks || 0)
      - Number(a.clicks || 0)
  );

  return (
    kpiGrid([
      [
        "Ключевых фраз",
        number(
          summary.total_keywords
          ?? rows.length
        )
      ],
      [
        "Order",
        decimal(
          summary.order_conversions
        )
      ],
      [
        "Вебинары",
        decimal(
          summary.webinar_conversions
        )
      ],
      [
        "Опросы",
        decimal(
          summary.survey_conversions
        )
      ],
    ])
    +
    `<div class="note" style="margin-bottom:12px">
      RARELY_SERVED — это ServingStatus группы, который Direct возвращает
      вместе с ключом. Такой статус помогает быстро находить семантику,
      которая фактически получает очень мало показов.
    </div>`
    +
    table(
      [
        "#",
        "Ключевая фраза",
        "State",
        "Status",
        "ServingStatus",
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
          (x, i) => {
            const states =
              x.states?.length
                ? x.states
                    .map(keywordStateLabel)
                    .join(", ")
                : "—";

            const statuses =
              x.statuses?.length
                ? x.statuses
                    .map(keywordModerationLabel)
                    .join(", ")
                : "—";

            const serving =
              x.serving_statuses?.length
                ? x.serving_statuses
                    .map(keywordServingLabel)
                    .join(", ")
                : "—";

            return `
              <tr>
                <td>${i + 1}</td>
                <td>
                  <strong>${esc(x.keyword)}</strong>
                  ${
                    x.rarely_served
                      ? `<div style="
                          margin-top:4px;
                          color:#ffb65c;
                          font-size:9px;
                        ">
                          мало показов / RARELY_SERVED
                        </div>`
                      : ""
                  }
                </td>
                <td>${esc(states)}</td>
                <td>${esc(statuses)}</td>
                <td>${esc(serving)}</td>
                <td>${decimal(x.order_conversions)}</td>
                <td>${x.order_cpa ? money(x.order_cpa) : "—"}</td>
                <td>${decimal(x.webinar_conversions)}</td>
                <td>${decimal(x.survey_conversions)}</td>
                <td>${x.survey_cpa ? money(x.survey_cpa) : "—"}</td>
                <td>${number(x.clicks)}</td>
                <td>${pct(x.ctr)}</td>
                <td>${money(x.cost)}</td>
                <td>
                  ${esc(
                    (x.campaign_names || []).join(", ")
                    || x.campaign_name
                    || "—"
                  )}
                </td>
              </tr>
            `;
          }
        )
        .join("")
    )
  );
}

function renderKeywordStatuses() {
  const data =
    DATA.keyword_configuration
    || {};

  const rows =
    data.rows
    || [];

  const s =
    data.summary
    || {};

  if (!rows.length) {
    return moduleEmpty(
      "Keywords.get не вернул данные по статусам ключей."
    );
  }

  const campaignMap =
    new Map(
      (DATA.campaigns || [])
        .map(
          x => [
            String(x.campaign_id || ""),
            x.name || x.campaign_name || "",
          ]
        )
    );

  const sorted =
    [...rows]
      .sort(
        (a, b) => {
          if (
            a.serving_status === "RARELY_SERVED"
            && b.serving_status !== "RARELY_SERVED"
          ) {
            return -1;
          }

          if (
            b.serving_status === "RARELY_SERVED"
            && a.serving_status !== "RARELY_SERVED"
          ) {
            return 1;
          }

          return String(a.keyword)
            .localeCompare(
              String(b.keyword),
              "ru"
            );
        }
      );

  return (
    kpiGrid([
      ["Ключей из API", number(s.keywords)],
      ["ON", number(s.on)],
      ["RARELY_SERVED", number(s.rarely_served)],
      ["REJECTED", number(s.rejected)],
    ])
    +
    table(
      [
        "Ключ",
        "Кампания",
        "State",
        "Status",
        "ServingStatus",
        "ID ключа",
      ],
      sorted
        .map(
          x => `
            <tr>
              <td>
                <strong>${esc(x.keyword)}</strong>
              </td>
              <td>
                ${esc(
                  campaignMap.get(
                    String(x.campaign_id)
                  )
                  || x.campaign_id
                  || "—"
                )}
              </td>
              <td>${esc(keywordStateLabel(x.state))}</td>
              <td>${esc(keywordModerationLabel(x.status))}</td>
              <td>
                <strong style="
                  color:${
                    x.serving_status === "RARELY_SERVED"
                      ? "#ffb65c"
                      : "inherit"
                  };
                ">
                  ${esc(keywordServingLabel(x.serving_status))}
                </strong>
              </td>
              <td>${esc(x.id)}</td>
            </tr>
          `
        )
        .join("")
    )
  );
}

function renderNegativeKeywords() {
  const data =
    DATA.negative_keywords
    || {};

  const campaigns =
    data.campaigns
    || [];

  const s =
    data.summary
    || {};

  if (!campaigns.length) {
    return moduleEmpty(
      "Не удалось получить NegativeKeywords кампаний."
    );
  }

  return (
    kpiGrid([
      ["Кампаний", number(s.campaigns)],
      [
        "С минус-фразами",
        number(s.campaigns_with_negatives)
      ],
      [
        "Минус-фраз",
        number(s.negative_keywords)
      ],
      [
        "Потенциальных конфликтов",
        number(s.potential_conflicts)
      ],
    ])
    +
    `<div class="note" style="margin-bottom:12px">
      ${esc(
        data.note
        || "Проверка конфликтов основана на исторических конверсионных поисковых запросах."
      )}
    </div>`
    +
    table(
      [
        "Кампания",
        "NegativeKeywords",
        "Количество",
        "Потенциальные конфликты",
        "Исторические конверсионные запросы",
      ],
      campaigns
        .filter(
          x =>
            x.negative_count > 0
            || x.potential_conflict_count > 0
        )
        .map(
          x => {
            const conflicts =
              (x.potential_conflicts || [])
                .flatMap(
                  item =>
                    (item.historical_converting_queries || [])
                      .map(
                        query =>
                          `${item.negative_keyword} → ${query.query}`
                      )
                )
                .slice(0, 8);

            return `
              <tr>
                <td>
                  <strong>${esc(x.campaign_name)}</strong>
                </td>
                <td style="max-width:360px">
                  ${
                    x.negative_keywords?.length
                      ? x.negative_keywords
                          .map(
                            word =>
                              `<span style="
                                display:inline-block;
                                margin:2px 3px 2px 0;
                                padding:4px 7px;
                                border-radius:6px;
                                background:#091525;
                                font-size:9px;
                              ">${esc(word)}</span>`
                          )
                          .join("")
                      : "—"
                  }
                </td>
                <td>${number(x.negative_count)}</td>
                <td>
                  ${
                    x.potential_conflict_count > 0
                      ? `<strong style="color:#ffb65c">
                          ${number(x.potential_conflict_count)}
                        </strong>`
                      : "0"
                  }
                </td>
                <td style="max-width:420px">
                  ${
                    conflicts.length
                      ? conflicts
                          .map(
                            item =>
                              `<div style="
                                margin:3px 0;
                                font-size:10px;
                              ">${esc(item)}</div>`
                          )
                          .join("")
                      : "—"
                  }
                </td>
              </tr>
            `;
          }
        )
        .join("")
    )
  );
}

function renderKeywords() {
  const box =
    document.getElementById(
      "keywordBody"
    );

  if (!box) return;

  const rows =
    [...(DATA.keywords || [])]
      .filter(campaignPass);

  const summary =
    DATA.keyword_summary
    || {};

  let content = "";

  if (KEYWORD_SUBTAB === "statuses") {
    content =
      renderKeywordStatuses();

  } else if (KEYWORD_SUBTAB === "negatives") {
    content =
      renderNegativeKeywords();

  } else {
    content =
      rows.length
        ? renderKeywordPerformance(
            rows,
            summary
          )
        : moduleEmpty(
            "Ключевые фразы не найдены или по ним нет статистики."
          );
  }

  box.innerHTML =
    keywordTabs()
    + content;
}

function queryRecommendation(value) {
  return ({
    new_keyword_candidate: "🟢 Новый ключ",
    negative_candidate: "🔴 Минус-слово?",
    semantic_expansion_review: "🟡 Проверить расширение",
    converting: "🟢 Конвертирует",
    monitor: "⚪ Наблюдать",
  })[value] || "⚪ Наблюдать";
}

function searchInsightTabs() {
  const tabs = [
    ["queries", "Запросы"],
    ["gap", "Query → Keyword Gap"],
    ["cannibalization", "Cannibalization"],
  ];

  return `
    <div style="
      display:flex;
      gap:8px;
      flex-wrap:wrap;
      margin-bottom:16px;
    ">
      ${
        tabs
          .map(
            ([id, label]) => `
              <button
                type="button"
                data-search-insight-tab="${id}"
                style="
                  border:1px solid ${
                    SEARCH_INSIGHT_TAB === id
                      ? "#5aa7ff"
                      : "#20354e"
                  };
                  background:${
                    SEARCH_INSIGHT_TAB === id
                      ? "#15385c"
                      : "#0d1b2c"
                  };
                  color:${
                    SEARCH_INSIGHT_TAB === id
                      ? "#fff"
                      : "#9db1c8"
                  };
                  border-radius:9px;
                  padding:9px 12px;
                  cursor:pointer;
                "
              >
                ${esc(label)}
              </button>
            `
          )
          .join("")
      }
    </div>
  `;
}

function renderQueries() {
  const box =
    document.getElementById(
      "queryBody"
    );

  if (!box) return;

  const data =
    DATA.search_queries
    || {};

  const rows =
    (data.rows || [])
      .filter(campaignPass);

  const opportunities =
    DATA.search_opportunities
    || {};

  const gapRows =
    (opportunities.query_gap || [])
      .filter(campaignPass);

  const cannibalization =
    (opportunities.cannibalization || [])
      .filter(campaignPass);

  let content = "";

  if (
    SEARCH_INSIGHT_TAB === "gap"
  ) {
    content =
      kpiGrid([
        ["Кандидатов в ключи", number(gapRows.length)],
        [
          "Order",
          decimal(
            gapRows.reduce(
              (sum, x) =>
                sum + Number(x.order_conversions || 0),
              0
            )
          )
        ],
        [
          "Все конверсии",
          decimal(
            gapRows.reduce(
              (sum, x) =>
                sum + Number(x.conversions || 0),
              0
            )
          )
        ],
        [
          "Расход",
          money(
            gapRows.reduce(
              (sum, x) =>
                sum + Number(x.cost || 0),
              0
            )
          )
        ],
      ])
      +
      `<div class="note" style="margin-bottom:12px">
        Здесь только конверсионные запросы, которых нет как отдельного
        точного ключа в той же кампании. Это кандидаты на расширение семантики,
        а не автоматическая рекомендация добавить каждый запрос.
      </div>`
      +
      table(
        [
          "Запрос",
          "Кампании",
          "Текущий ключ / маршрут",
          "Тип",
          "Order",
          "Опрос",
          "Клики",
          "Расход",
        ],
        gapRows
          .map(
            x => `
              <tr>
                <td>
                  <strong>${esc(x.query)}</strong>
                </td>

                <td>
                  ${esc((x.campaign_names || []).join(", ") || "—")}
                </td>

                <td>
                  ${esc(x.criterion || x.matched_keyword || "—")}
                </td>

                <td>${esc(x.match_type || "—")}</td>

                <td>${decimal(x.order_conversions)}</td>

                <td>${decimal(x.survey_conversions)}</td>

                <td>${number(x.clicks)}</td>

                <td>${money(x.cost)}</td>
              </tr>
            `
          )
          .join("")
      );

  } else if (
    SEARCH_INSIGHT_TAB
    === "cannibalization"
  ) {
    content =
      kpiGrid([
        ["Запросов с несколькими маршрутами", number(cannibalization.length)],
        [
          "Расход",
          money(
            cannibalization.reduce(
              (sum, x) =>
                sum + Number(x.cost || 0),
              0
            )
          )
        ],
        [
          "Order",
          decimal(
            cannibalization.reduce(
              (sum, x) =>
                sum + Number(x.order_conversions || 0),
              0
            )
          )
        ],
        [
          "Маршрутов",
          number(
            cannibalization.reduce(
              (sum, x) =>
                sum + Number(x.route_count || 0),
              0
            )
          )
        ],
      ])
      +
      `<div class="note" style="margin-bottom:12px">
        Один пользовательский запрос может обслуживаться несколькими
        ключами, типами соответствия или кампаниями.
        Это помогает находить внутреннюю конкуренцию и распыление данных.
      </div>`
      +
      table(
        [
          "Запрос",
          "Маршрутов",
          "Кампаний",
          "Order",
          "Расход",
          "Как маршрутизируется",
        ],
        cannibalization
          .map(
            x => `
              <tr>
                <td>
                  <strong>${esc(x.query)}</strong>
                </td>

                <td>${number(x.route_count)}</td>

                <td>${number(x.campaign_count)}</td>

                <td>${decimal(x.order_conversions)}</td>

                <td>${money(x.cost)}</td>

                <td style="max-width:520px">
                  ${
                    (x.routes || [])
                      .slice(0, 6)
                      .map(
                        route => `
                          <div style="
                            padding:4px 0;
                            font-size:9px;
                            border-bottom:1px solid #1d3047;
                          ">
                            ${esc(
                              (route.campaign_names || []).join(", ")
                              || "—"
                            )}
                            · ${esc(route.criterion || "—")}
                            · ${esc(route.match_type || "—")}
                            · ${money(route.cost)}
                          </div>
                        `
                      )
                      .join("")
                  }
                </td>
              </tr>
            `
          )
          .join("")
      );

  } else {
    const s =
      data.summary
      || {};

    content =
      kpiGrid([
        ["Реальных запросов", number(rows.length)],
        [
          "Order",
          decimal(
            rows.reduce(
              (sum, x) =>
                sum + Number(x.order_conversions || 0),
              0
            )
          )
        ],
        [
          "Кандидатов в минус",
          number(
            rows.filter(
              x =>
                x.recommendation
                === "negative_candidate"
            ).length
          )
        ],
        [
          "Новых ключей",
          number(
            gapRows.length
          )
        ],
      ])
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
          .slice(0, 1000)
          .map(
            x => `
              <tr>
                <td>
                  <strong>${esc(x.query)}</strong>
                </td>

                <td>
                  ${esc(x.criterion || x.matched_keyword || "—")}
                </td>

                <td>${esc(x.match_type)}</td>

                <td>${decimal(x.order_conversions)}</td>

                <td>
                  ${x.order_cpa ? money(x.order_cpa) : "—"}
                </td>

                <td>${decimal(x.webinar_conversions)}</td>

                <td>${decimal(x.survey_conversions)}</td>

                <td>${number(x.clicks)}</td>

                <td>${money(x.cost)}</td>

                <td>
                  ${esc(queryRecommendation(x.recommendation))}
                </td>
              </tr>
            `
          )
          .join("")
      );
  }

  box.innerHTML =
    searchInsightTabs()
    + content;
}



function placementStatus(status) {
  return ({
    waste: "🔴 Расход без результата",
    bad_traffic: "🔴 Низкое качество",
    strong: "🟢 Сильная площадка",
    normal: "⚪ Норма",
  })[status] || "⚪ Норма";
}

function placementFilterInput(
  key,
  placeholder,
  value,
  type = "text"
) {
  return `
    <input
      type="${type}"
      data-placement-filter="${key}"
      value="${esc(value)}"
      placeholder="${esc(placeholder)}"
      style="
        width:100%;
        min-width:90px;
        background:#091525;
        color:#dce7f2;
        border:1px solid #20354e;
        border-radius:7px;
        padding:7px 8px;
        font-size:9px;
      "
    >
  `;
}

function placementFilterPass(x) {
  if (
    PLACEMENT_FILTERS.campaign !== "all"
    && String(
      x.campaign_id
      || ""
    ) !== PLACEMENT_FILTERS.campaign
  ) {
    return false;
  }

  if (
    PLACEMENT_FILTERS.placement
    && !String(x.placement || "")
      .toLowerCase()
      .includes(
        PLACEMENT_FILTERS.placement
          .toLowerCase()
      )
  ) {
    return false;
  }

  if (
    PLACEMENT_FILTERS.network !== "all"
    && String(x.external_network || "")
      !== PLACEMENT_FILTERS.network
  ) {
    return false;
  }

  if (
    PLACEMENT_FILTERS.status !== "all"
    && String(x.status || "")
      !== PLACEMENT_FILTERS.status
  ) {
    return false;
  }

  const numericRules = [
    ["minOrder", "order_conversions", ">="],
    ["maxOrderCpa", "order_cpa", "<="],
    ["minWebinar", "webinar_conversions", ">="],
    ["minSurvey", "survey_conversions", ">="],
    ["minClicks", "clicks", ">="],
    ["minCost", "cost", ">="],
    ["maxBounce", "bounce_rate", "<="],
    ["minDepth", "avg_pageviews", ">="],
  ];

  for (
    const [filterKey, rowKey, operator]
    of numericRules
  ) {
    const raw =
      PLACEMENT_FILTERS[filterKey];

    if (
      raw === ""
      || raw == null
    ) {
      continue;
    }

    const filterValue =
      Number(raw);

    const rowValue =
      Number(x[rowKey] || 0);

    if (
      operator === ">="
      && rowValue < filterValue
    ) {
      return false;
    }

    if (
      operator === "<="
      && (
        rowValue === 0
          ? false
          : rowValue > filterValue
      )
    ) {
      return false;
    }
  }

  return true;
}

function placementSortValue(
  row,
  field
) {
  if (
    field === "placement"
    || field === "category"
    || field === "external_network"
    || field === "status"
  ) {
    return String(
      row[field]
      || ""
    ).toLowerCase();
  }

  return Number(
    row[field]
    || 0
  );
}

function sortPlacementRows(
  rows
) {
  return [...rows]
    .sort(
      (a, b) => {
        const av =
          placementSortValue(
            a,
            PLACEMENT_SORT
          );

        const bv =
          placementSortValue(
            b,
            PLACEMENT_SORT
          );

        let result = 0;

        if (
          typeof av === "string"
        ) {
          result =
            av.localeCompare(
              bv,
              "ru"
            );

        } else {
          result =
            av - bv;
        }

        return (
          PLACEMENT_SORT_DIR === "desc"
            ? -result
            : result
        );
      }
    );
}

function renderPlacements() {
  const box =
    document.getElementById(
      "placementBody"
    );

  if (!box) return;

  const data =
    DATA.placements
    || {};

  const allRows =
    (data.rows || [])
      .filter(campaignPass);

  if (!allRows.length) {
    box.innerHTML =
      moduleEmpty(
        "По площадкам РСЯ данных нет для выбранных кампаний."
      );
    return;
  }

  // Список кампаний именно из строк Placement Intelligence.
  // В v13.1 dropdown ссылался на placementCampaigns,
  // но переменная не создавалась — из-за ReferenceError
  // render() останавливался на Площадках РСЯ, поэтому
  // Аудитория, География и следующие вкладки тоже оставались пустыми.
  const placementCampaigns =
    [...new Map(
      allRows
        .filter(
          x =>
            String(
              x.campaign_id
              || ""
            )
        )
        .map(
          x => [
            String(
              x.campaign_id
            ),
            x.campaign_name
              || `Кампания ${x.campaign_id}`,
          ]
        )
    ).entries()]
      .sort(
        (a, b) =>
          String(a[1])
            .localeCompare(
              String(b[1]),
              "ru"
            )
      );

  // Если глобальный фильтр кампаний изменился и локально
  // была выбрана уже недоступная кампания — возвращаем "Все".
  if (
    PLACEMENT_FILTERS.campaign !== "all"
    && !placementCampaigns.some(
      ([id]) =>
        id === PLACEMENT_FILTERS.campaign
    )
  ) {
    PLACEMENT_FILTERS.campaign = "all";
  }

  const networks =
    [...new Set(
      allRows
        .map(
          x =>
            String(
              x.external_network
              || ""
            )
        )
        .filter(Boolean)
    )]
      .sort();

  const filtered =
    sortPlacementRows(
      allRows.filter(
        placementFilterPass
      )
    );

  const categories =
    (data.categories || [])
      .filter(
        category => {
          // Category rows do not have campaign dimension,
          // therefore recalc categories from filtered rows below.
          return true;
        }
      );

  const categoryMap =
    new Map();

  for (const row of filtered) {
    const category =
      row.category
      || "Прочее";

    if (
      !categoryMap.has(
        category
      )
    ) {
      categoryMap.set(
        category,
        {
          category,
          placements: 0,
          cost: 0,
          clicks: 0,
          order_conversions: 0,
        }
      );
    }

    const item =
      categoryMap.get(
        category
      );

    item.placements += 1;
    item.cost +=
      Number(row.cost || 0);
    item.clicks +=
      Number(row.clicks || 0);
    item.order_conversions +=
      Number(
        row.order_conversions
        || 0
      );
  }

  const filteredCategories =
    [...categoryMap.values()]
      .map(
        x => ({
          ...x,
          order_cpa:
            x.order_conversions > 0
              ? x.cost
                / x.order_conversions
              : 0,
        })
      )
      .sort(
        (a, b) =>
          b.cost - a.cost
      );

  box.innerHTML =
    kpiGrid([
      ["Площадок", number(filtered.length)],
      [
        "Кампаний",
        number(
          new Set(
            filtered
              .map(
                x =>
                  String(
                    x.campaign_id
                    || ""
                  )
              )
              .filter(Boolean)
          ).size
        )
      ],
      [
        "Расход",
        money(
          filtered.reduce(
            (sum, x) =>
              sum + Number(x.cost || 0),
            0
          )
        )
      ],
      [
        "Order",
        decimal(
          filtered.reduce(
            (sum, x) =>
              sum + Number(x.order_conversions || 0),
            0
          )
        )
      ],
      [
        "Кандидатов на проверку",
        number(
          filtered.filter(
            x =>
              x.status === "waste"
              || x.status === "bad_traffic"
          ).length
        )
      ],
    ])
    +
    `
      <div class="section-head" style="margin-top:10px">
        <div>
          <h3>Категории площадок</h3>
          <p>
            Автоматическая эвристическая группировка:
            IT, VPN, погода, новости, финансы, игры и др.
          </p>
        </div>
      </div>

      ${
        table(
          [
            "Категория",
            "Площадок",
            "Расход",
            "Клики",
            "Order",
            "CPA Order",
          ],
          filteredCategories
            .map(
              x => `
                <tr>
                  <td>
                    <strong>${esc(x.category)}</strong>
                  </td>
                  <td>${number(x.placements)}</td>
                  <td>${money(x.cost)}</td>
                  <td>${number(x.clicks)}</td>
                  <td>${decimal(x.order_conversions)}</td>
                  <td>
                    ${x.order_cpa ? money(x.order_cpa) : "—"}
                  </td>
                </tr>
              `
            )
            .join("")
        )
      }

      <div class="section-head" style="margin-top:20px">
        <div>
          <h3>Площадки</h3>
          <p>
            Сначала выберите одну кампанию или оставьте все выбранные.
            Каждая площадка хранится отдельной строкой внутри конкретной кампании,
            а CPA сравнивается с baseline этой же кампании.
          </p>
        </div>
      </div>

      <div style="
        display:flex;
        gap:8px;
        flex-wrap:wrap;
        align-items:center;
        margin-bottom:10px;
      ">
        <select
          data-placement-filter="campaign"
          style="
            min-width:280px;
            background:#091525;
            color:#dce7f2;
            border:1px solid #20354e;
            border-radius:8px;
            padding:9px 10px;
          "
        >
          <option value="all">
            Все выбранные кампании
          </option>

          ${
            placementCampaigns
              .map(
                ([id, name]) => `
                  <option
                    value="${esc(id)}"
                    ${
                      PLACEMENT_FILTERS.campaign === id
                        ? "selected"
                        : ""
                    }
                  >
                    ${esc(name)}
                  </option>
                `
              )
              .join("")
          }
        </select>

        <select
          id="placementSortSelect"
        >
          ${
            [
              ["cost", "Расход"],
              ["clicks", "Клики"],
              ["order_conversions", "Order"],
              ["order_cpa", "CPA Order"],
              ["survey_conversions", "Опрос"],
              ["bounce_rate", "Bounce Rate"],
              ["avg_pageviews", "Глубина"],
              ["placement", "Название площадки"],
              ["category", "Категория"],
            ]
              .map(
                ([value, label]) => `
                  <option
                    value="${value}"
                    ${
                      PLACEMENT_SORT === value
                        ? "selected"
                        : ""
                    }
                  >
                    Сортировка: ${esc(label)}
                  </option>
                `
              )
              .join("")
          }
        </select>

        <select
          id="placementSortDir"
        >
          <option
            value="desc"
            ${
              PLACEMENT_SORT_DIR === "desc"
                ? "selected"
                : ""
            }
          >
            От большего к меньшему
          </option>

          <option
            value="asc"
            ${
              PLACEMENT_SORT_DIR === "asc"
                ? "selected"
                : ""
            }
          >
            От меньшего к большему
          </option>
        </select>

        ${placementFilterInput(
          "placement",
          "Площадка содержит…",
          PLACEMENT_FILTERS.placement
        )}

        <select
          data-placement-filter="network"
        >
          <option value="all">
            Все сети
          </option>
          ${
            networks
              .map(
                value => `
                  <option
                    value="${esc(value)}"
                    ${
                      PLACEMENT_FILTERS.network === value
                        ? "selected"
                        : ""
                    }
                  >
                    ${esc(value)}
                  </option>
                `
              )
              .join("")
          }
        </select>

        ${placementFilterInput(
          "minOrder",
          "Order ≥",
          PLACEMENT_FILTERS.minOrder,
          "number"
        )}

        ${placementFilterInput(
          "maxOrderCpa",
          "CPA ≤",
          PLACEMENT_FILTERS.maxOrderCpa,
          "number"
        )}

        ${placementFilterInput(
          "minClicks",
          "Клики ≥",
          PLACEMENT_FILTERS.minClicks,
          "number"
        )}

        ${placementFilterInput(
          "minCost",
          "Расход ≥",
          PLACEMENT_FILTERS.minCost,
          "number"
        )}
      </div>
    `
    +
    table(
      [
        "Площадка",
        "Категория",
        "Кампания",
        "Сеть",
        "Order",
        "CPA Order",
        "Baseline CPA кампании",
        "Вебинар",
        "Опрос",
        "Клики",
        "Расход",
        "Bounce",
        "Глубина",
        "Статус",
      ],
      filtered
        .slice(0, 1500)
        .map(
          x => `
            <tr>
              <td>
                <strong>${esc(x.placement)}</strong>
              </td>

              <td>${esc(x.category || "Прочее")}</td>

              <td>${esc(x.campaign_name || "—")}</td>

              <td>${esc(x.external_network || "—")}</td>

              <td>${decimal(x.order_conversions)}</td>

              <td>
                ${x.order_cpa ? money(x.order_cpa) : "—"}
              </td>

              <td>
                ${
                  x.campaign_baseline_order_cpa
                    ? money(
                        x.campaign_baseline_order_cpa
                      )
                    : "—"
                }
              </td>

              <td>${decimal(x.webinar_conversions)}</td>

              <td>${decimal(x.survey_conversions)}</td>

              <td>${number(x.clicks)}</td>

              <td>${money(x.cost)}</td>

              <td>
                ${x.sessions ? pct(x.bounce_rate) : "—"}
              </td>

              <td>
                ${x.sessions ? decimal(x.avg_pageviews) : "—"}
              </td>

              <td>${esc(placementStatus(x.status))}</td>
            </tr>
          `
        )
        .join("")
    );
}



const AUDIENCE_LABELS = {
  age: {
    AGE_0_17: "0–17",
    AGE_18_24: "18–24",
    AGE_25_34: "25–34",
    AGE_35_44: "35–44",
    AGE_45_54: "45–54",
    AGE_55: "55+",
    UNKNOWN: "Не определён",
  },

  gender: {
    GENDER_MALE: "Мужчины",
    GENDER_FEMALE: "Женщины",
    UNKNOWN: "Не определён",
  },

  income_grade: {
    VERY_HIGH: "Топ 1%",
    HIGH: "Топ 2–5%",
    ABOVE_AVERAGE: "Топ 6–10%",
    OTHER: "Остальные 90%",
    UNKNOWN: "Не определён",
  },

  device: {
    DESKTOP: "Desktop",
    MOBILE: "Mobile",
    TABLET: "Tablet",
    SMART_TV: "Smart TV",
    UNKNOWN: "Не определён",
  },
};

function audienceValueLabel(field, value) {
  return AUDIENCE_LABELS[field]?.[value]
    || value
    || "Не определён";
}

function audienceLabel(x) {
  return [
    audienceValueLabel("age", x.age),
    audienceValueLabel("gender", x.gender),
    audienceValueLabel("income_grade", x.income_grade),
    audienceValueLabel("device", x.device),
  ].join(" · ");
}

function audienceStatus(x) {
  if (x.status === "opportunity") {
    return "🟢 Потенциал";
  }

  if (x.status === "expensive") {
    return "🔴 Дорого";
  }

  return "⚪ Норма";
}

function audienceFilterPass(row) {
  for (
    const [field, selected]
    of Object.entries(AUDIENCE_FILTERS)
  ) {
    if (
      selected.size
      && !selected.has(
        String(row[field] || "UNKNOWN")
      )
    ) {
      return false;
    }
  }

  return true;
}

function audienceFilterGroup(field, title, values) {
  const selected =
    AUDIENCE_FILTERS[field];

  return `
    <div style="
      padding:14px;
      border:1px solid #20354e;
      border-radius:12px;
      background:#0e1c2e;
    ">
      <div style="
        font-size:10px;
        color:#8ea2bb;
        margin-bottom:10px;
        text-transform:uppercase;
        letter-spacing:.06em;
      ">
        ${esc(title)}
      </div>

      <div style="
        display:flex;
        flex-wrap:wrap;
        gap:7px;
      ">
        ${
          values
            .map(
              value => {
                const active =
                  selected.has(
                    String(value)
                  );

                return `
                  <button
                    type="button"
                    data-audience-filter="${esc(field)}"
                    data-audience-value="${esc(value)}"
                    style="
                      border:1px solid ${active ? "#5aa7ff" : "#20354e"};
                      background:${active ? "#15385c" : "#091525"};
                      color:${active ? "#fff" : "#a8bad0"};
                      border-radius:999px;
                      padding:7px 10px;
                      cursor:pointer;
                      font-size:10px;
                    "
                  >
                    ${esc(audienceValueLabel(field, value))}
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

function audienceMetricValue(row) {
  return Number(
    row[AUDIENCE_METRIC]
    || 0
  );
}

function pieData(rows, field) {
  const map = new Map();

  for (const row of rows) {
    const key =
      String(row[field] || "UNKNOWN");

    map.set(
      key,
      (map.get(key) || 0)
      + audienceMetricValue(row)
    );
  }

  return [...map.entries()]
    .map(
      ([key, value]) => ({
        key,
        label:
          audienceValueLabel(
            field,
            key
          ),
        value,
      })
    )
    .filter(x => x.value > 0)
    .sort((a, b) => b.value - a.value);
}

function pieChart(title, field, data) {
  if (!data.length) {
    return `
      <div style="
        border:1px solid #20354e;
        border-radius:14px;
        padding:16px;
        background:#0e1c2e;
      ">
        <strong>${esc(title)}</strong>
        <div style="
          color:#8ea2bb;
          font-size:11px;
          margin-top:12px;
        ">
          Нет данных для выбранной метрики.
        </div>
      </div>
    `;
  }

  const total =
    data.reduce(
      (sum, x) =>
        sum + x.value,
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

  let cursor = 0;

  const slices =
    data.map(
      (x, index) => {
        const from =
          total
            ? cursor / total * 100
            : 0;

        cursor += x.value;

        const to =
          total
            ? cursor / total * 100
            : 0;

        return `${colors[index % colors.length]} ${from}% ${to}%`;
      }
    );

  return `
    <div style="
      border:1px solid #20354e;
      border-radius:14px;
      padding:16px;
      background:#0e1c2e;
      min-width:0;
    ">
      <strong>${esc(title)}</strong>

      <div style="
        display:grid;
        grid-template-columns:150px 1fr;
        gap:18px;
        align-items:center;
        margin-top:15px;
      ">
        <div style="
          width:140px;
          height:140px;
          border-radius:50%;
          background:conic-gradient(${slices.join(",")});
          position:relative;
          margin:auto;
        ">
          <div style="
            position:absolute;
            inset:31px;
            border-radius:50%;
            background:#0e1c2e;
            display:grid;
            place-items:center;
            text-align:center;
            font-size:10px;
            color:#8ea2bb;
          ">
            ${esc(audienceMetricLabel())}
          </div>
        </div>

        <div style="
          display:grid;
          gap:8px;
          min-width:0;
        ">
          ${
            data
              .slice(0, 8)
              .map(
                (x, index) => {
                  const share =
                    total
                      ? x.value / total * 100
                      : 0;

                  return `
                    <div style="
                      display:grid;
                      grid-template-columns:10px minmax(0,1fr) auto;
                      gap:7px;
                      align-items:center;
                      font-size:10px;
                    ">
                      <span style="
                        width:9px;
                        height:9px;
                        border-radius:50%;
                        background:${colors[index % colors.length]};
                      "></span>

                      <span style="
                        color:#b8c8d9;
                        overflow:hidden;
                        text-overflow:ellipsis;
                      ">
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

function audienceMetricLabel() {
  return ({
    cost: "Расход",
    clicks: "Клики",
    order_conversions: "Order",
    webinar_conversions: "Вебинары",
    survey_conversions: "Опросы",
  })[AUDIENCE_METRIC]
  || AUDIENCE_METRIC;
}

function renderAudience() {
  const box =
    document.getElementById(
      "audienceBody"
    );

  if (!box) return;

  const data =
    DATA.audience
    || {};

  const rows =
    (data.rows || [])
      .filter(campaignPass);

  const s =
    data.summary
    || {};

  if (!rows.length) {
    box.innerHTML =
      moduleEmpty(
        "По аудиториям данных нет или модуль недоступен."
      );
    return;
  }

  const values = {
    age:
      [...new Set(rows.map(x => String(x.age || "UNKNOWN")))],
    gender:
      [...new Set(rows.map(x => String(x.gender || "UNKNOWN")))],
    income_grade:
      [...new Set(rows.map(x => String(x.income_grade || "UNKNOWN")))],
    device:
      [...new Set(rows.map(x => String(x.device || "UNKNOWN")))],
  };

  const filtered =
    rows.filter(
      audienceFilterPass
    );

  const filteredCost =
    filtered.reduce(
      (sum, x) =>
        sum + Number(x.cost || 0),
      0
    );

  const filteredOrders =
    filtered.reduce(
      (sum, x) =>
        sum + Number(x.order_conversions || 0),
      0
    );

  const filteredWebinars =
    filtered.reduce(
      (sum, x) =>
        sum + Number(x.webinar_conversions || 0),
      0
    );

  const filteredSurveys =
    filtered.reduce(
      (sum, x) =>
        sum + Number(x.survey_conversions || 0),
      0
    );

  box.innerHTML = `
    ${kpiGrid([
      ["Сегментов после фильтра", number(filtered.length)],
      ["Order", decimal(filteredOrders)],
      ["Вебинары", decimal(filteredWebinars)],
      ["Опросы", decimal(filteredSurveys)],
    ])}

    <div style="
      display:flex;
      justify-content:space-between;
      align-items:center;
      gap:12px;
      flex-wrap:wrap;
      margin:0 0 12px;
    ">
      <div>
        <strong>Фильтры аудитории</strong>
        <div style="
          color:#8ea2bb;
          font-size:11px;
          margin-top:4px;
        ">
          Внутри одной характеристики можно выбрать несколько значений.
          Разные характеристики комбинируются между собой.
        </div>
      </div>

      <div style="
        display:flex;
        gap:8px;
        align-items:center;
      ">
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
          <option value="cost" ${AUDIENCE_METRIC === "cost" ? "selected" : ""}>
            Диаграммы: расход
          </option>
          <option value="clicks" ${AUDIENCE_METRIC === "clicks" ? "selected" : ""}>
            Диаграммы: клики
          </option>
          <option value="order_conversions" ${AUDIENCE_METRIC === "order_conversions" ? "selected" : ""}>
            Диаграммы: Order
          </option>
          <option value="webinar_conversions" ${AUDIENCE_METRIC === "webinar_conversions" ? "selected" : ""}>
            Диаграммы: вебинары
          </option>
          <option value="survey_conversions" ${AUDIENCE_METRIC === "survey_conversions" ? "selected" : ""}>
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

    <div style="
      display:grid;
      grid-template-columns:repeat(auto-fit,minmax(260px,1fr));
      gap:10px;
      margin-bottom:16px;
    ">
      ${audienceFilterGroup("age", "Возраст", values.age)}
      ${audienceFilterGroup("gender", "Пол", values.gender)}
      ${audienceFilterGroup("income_grade", "Платежеспособность", values.income_grade)}
      ${audienceFilterGroup("device", "Устройство", values.device)}
    </div>

    <div style="
      display:grid;
      grid-template-columns:repeat(auto-fit,minmax(280px,1fr));
      gap:12px;
      margin-bottom:18px;
    ">
      ${pieChart("Возраст", "age", pieData(filtered, "age"))}
      ${pieChart("Платежеспособность", "income_grade", pieData(filtered, "income_grade"))}
      ${pieChart("Устройства", "device", pieData(filtered, "device"))}
    </div>

    <div class="note" style="margin-bottom:12px">
      Расход в текущем фильтре:
      <strong>${money(filteredCost)}</strong>.
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
          .slice(0, 500)
          .map(
            x => `
              <tr>
                <td>
                  <strong>${esc(audienceLabel(x))}</strong>
                </td>
                <td>${decimal(x.order_conversions)}</td>
                <td>${x.order_cpa ? money(x.order_cpa) : "—"}</td>
                <td>${decimal(x.webinar_conversions)}</td>
                <td>${decimal(x.survey_conversions)}</td>
                <td>${x.survey_cpa ? money(x.survey_cpa) : "—"}</td>
                <td>${number(x.clicks)}</td>
                <td>${money(x.cost)}</td>
                <td>${esc(audienceStatus(x))}</td>
                <td>${esc(x.recommendation)}</td>
              </tr>
            `
          )
          .join("")
      )
    }
  `;
}

/* ============================== GEO ============================== */

function geoMetricValue(x) {
  return Number(
    x[GEO_METRIC]
    || 0
  );
}

function geoMetricLabel() {
  return ({
    cost: "Расход",
    clicks: "Клики",
    order_conversions: "Order",
    webinar_conversions: "Вебинары",
    survey_conversions: "Опросы",
  })[GEO_METRIC]
  || GEO_METRIC;
}

function geoFilterPass(x) {
  if (
    GEO_FILTERS.location
    && !String(x.location || "")
      .toLowerCase()
      .includes(
        GEO_FILTERS.location
          .toLowerCase()
      )
  ) {
    return false;
  }

  if (
    GEO_FILTERS.minCost !== ""
    && Number(x.cost || 0)
      < Number(GEO_FILTERS.minCost)
  ) {
    return false;
  }

  if (
    GEO_FILTERS.onlyWithConversions
  ) {
    if (
      GEO_FILTERS.conversionType === "order"
      && Number(x.order_conversions || 0) <= 0
    ) {
      return false;
    }

    if (
      GEO_FILTERS.conversionType === "webinar"
      && Number(x.webinar_conversions || 0) <= 0
    ) {
      return false;
    }

    if (
      GEO_FILTERS.conversionType === "survey"
      && Number(x.survey_conversions || 0) <= 0
    ) {
      return false;
    }

    if (
      GEO_FILTERS.conversionType === "all"
      && (
        Number(x.order_conversions || 0)
        + Number(x.webinar_conversions || 0)
        + Number(x.survey_conversions || 0)
      ) <= 0
    ) {
      return false;
    }
  }

  return true;
}

function renderGeo() {
  const box =
    document.getElementById(
      "geoBody"
    );

  if (!box) return;

  const data =
    DATA.geo
    || {};

  const rows =
    (data.locations || [])
      .filter(campaignPass);

  const pairs =
    (data.target_presence_pairs || [])
      .filter(campaignPass);

  const s =
    data.summary
    || {};

  if (!rows.length) {
    box.innerHTML =
      moduleEmpty(
        "Географический разрез недоступен или пуст."
      );
    return;
  }

  const filtered =
    rows.filter(
      geoFilterPass
    );

  const mismatch =
    pairs
      .filter(
        x =>
          x.differs_from_target
      )
      .filter(
        x =>
          !GEO_FILTERS.location
          || String(x.presence_location || "")
            .toLowerCase()
            .includes(
              GEO_FILTERS.location
                .toLowerCase()
            )
      )
      .slice(0, 100);

  const donutData =
    genericDonutData(
      filtered,
      x => x.location,
      geoMetricValue,
      8
    );

  box.innerHTML =
    kpiGrid([
      ["Фактических регионов", number(s.actual_locations)],
      ["После фильтра", number(filtered.length)],
      ["Order", decimal(s.order_conversions)],
      ["Опросы", decimal(s.survey_conversions)],
    ])
    +
    `
      <div style="
        display:flex;
        gap:8px;
        flex-wrap:wrap;
        align-items:center;
        margin-bottom:14px;
      ">
        <input
          type="text"
          data-geo-filter="location"
          value="${esc(GEO_FILTERS.location)}"
          placeholder="Регион содержит…"
          style="
            min-width:220px;
            background:#091525;
            color:#dce7f2;
            border:1px solid #20354e;
            border-radius:8px;
            padding:9px 10px;
          "
        >

        <input
          type="number"
          data-geo-filter="minCost"
          value="${esc(GEO_FILTERS.minCost)}"
          placeholder="Расход ≥"
          style="
            width:130px;
            background:#091525;
            color:#dce7f2;
            border:1px solid #20354e;
            border-radius:8px;
            padding:9px 10px;
          "
        >

        <select
          data-geo-filter="conversionType"
          style="
            background:#091525;
            color:#dce7f2;
            border:1px solid #20354e;
            border-radius:8px;
            padding:9px 10px;
          "
        >
          <option value="all" ${
            GEO_FILTERS.conversionType === "all"
              ? "selected"
              : ""
          }>Все конверсии</option>
          <option value="order" ${
            GEO_FILTERS.conversionType === "order"
              ? "selected"
              : ""
          }>Order</option>
          <option value="webinar" ${
            GEO_FILTERS.conversionType === "webinar"
              ? "selected"
              : ""
          }>Вебинары</option>
          <option value="survey" ${
            GEO_FILTERS.conversionType === "survey"
              ? "selected"
              : ""
          }>Опросы</option>
        </select>

        <label style="
          display:flex;
          gap:7px;
          align-items:center;
          color:#a8bad0;
          font-size:10px;
        ">
          <input
            type="checkbox"
            data-geo-filter="onlyWithConversions"
            ${
              GEO_FILTERS.onlyWithConversions
                ? "checked"
                : ""
            }
          >
          Только с выбранными конверсиями
        </label>

        <select
          id="geoMetricSelect"
          style="
            margin-left:auto;
            background:#091525;
            color:#dce7f2;
            border:1px solid #20354e;
            border-radius:8px;
            padding:9px 10px;
          "
        >
          ${
            [
              ["cost", "Pie: расход"],
              ["clicks", "Pie: клики"],
              ["order_conversions", "Pie: Order"],
              ["webinar_conversions", "Pie: вебинары"],
              ["survey_conversions", "Pie: опросы"],
            ]
              .map(
                ([value, label]) => `
                  <option
                    value="${value}"
                    ${
                      GEO_METRIC === value
                        ? "selected"
                        : ""
                    }
                  >
                    ${esc(label)}
                  </option>
                `
              )
              .join("")
          }
        </select>
      </div>

      <div style="
        display:grid;
        grid-template-columns:minmax(300px,520px);
        margin-bottom:16px;
      ">
        ${
          genericDonut(
            "Распределение по фактическим регионам",
            donutData,
            geoMetricLabel()
          )
        }
      </div>

      <div class="note" style="margin-bottom:12px">
        Отличие фактического региона от таргетинга не означает ошибку автоматически.
        Расход по отличающимся парам:
        <strong>${money(s.different_target_spend)}</strong>
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
      filtered
        .slice(0, 300)
        .map(
          x => `
            <tr>
              <td><strong>${esc(x.location)}</strong></td>
              <td>${decimal(x.order_conversions)}</td>
              <td>${x.order_cpa ? money(x.order_cpa) : "—"}</td>
              <td>${decimal(x.webinar_conversions)}</td>
              <td>${decimal(x.survey_conversions)}</td>
              <td>${x.survey_cpa ? money(x.survey_cpa) : "—"}</td>
              <td>${number(x.clicks)}</td>
              <td>${pct(x.ctr)}</td>
              <td>${money(x.cost)}</td>
            </tr>
          `
        )
        .join("")
    )
    +
    (
      mismatch.length
        ? `
          <div class="section-head">
            <div>
              <h3>Фактический регион отличается от таргетинга</h3>
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
                      <td>${esc(x.targeting_location)}</td>
                      <td>${esc(x.presence_location)}</td>
                      <td>${decimal(x.order_conversions)}</td>
                      <td>${decimal(x.webinar_conversions)}</td>
                      <td>${decimal(x.survey_conversions)}</td>
                      <td>${money(x.cost)}</td>
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

function slotLabel(value) {
  return ({
    PREMIUMBLOCK: "Премиум-показы",
    OTHER: "Остальные показы",
    COMMERCIAL_SEARCH: "Коммерческий поиск",
    ALONE: "Эксклюзивное размещение",
    SUGGEST: "Поисковые подсказки",
    PRODUCT_GALLERY: "Товарная галерея",
  })[value] || value || "—";
}

function positionMetricValue(x) {
  return Number(
    x[POSITION_METRIC]
    || 0
  );
}

function positionMetricLabel() {
  return ({
    cost: "Расход",
    clicks: "Клики",
    order_conversions: "Order",
    webinar_conversions: "Вебинары",
    survey_conversions: "Опросы",
  })[POSITION_METRIC]
  || POSITION_METRIC;
}

function positionFilterPass(x) {
  if (
    POSITION_FILTERS.campaign !== "all"
    && String(x.campaign_id || "")
      !== POSITION_FILTERS.campaign
  ) {
    return false;
  }

  if (
    POSITION_FILTERS.slot !== "all"
    && String(x.slot || "")
      !== POSITION_FILTERS.slot
  ) {
    return false;
  }

  if (
    POSITION_FILTERS.minClicks !== ""
    && Number(x.clicks || 0)
      < Number(POSITION_FILTERS.minClicks)
  ) {
    return false;
  }

  if (
    POSITION_FILTERS.minOrder !== ""
    && Number(x.order_conversions || 0)
      < Number(POSITION_FILTERS.minOrder)
  ) {
    return false;
  }

  if (
    POSITION_FILTERS.minCost !== ""
    && Number(x.cost || 0)
      < Number(POSITION_FILTERS.minCost)
  ) {
    return false;
  }

  return true;
}

function renderPositions() {
  const box =
    document.getElementById(
      "positionBody"
    );

  if (!box) return;

  const data =
    DATA.positions
    || {};

  const rows =
    (data.rows || [])
      .filter(campaignPass);

  const s =
    data.summary
    || {};

  if (!rows.length) {
    box.innerHTML =
      moduleEmpty(
        "По поисковым позициям данных нет или модуль недоступен."
      );
    return;
  }

  const campaigns =
    [...new Map(
      rows.map(
        x => [
          String(x.campaign_id || ""),
          x.campaign_name || x.campaign_id || "—",
        ]
      )
    ).entries()]
      .sort(
        (a, b) =>
          String(a[1])
            .localeCompare(
              String(b[1]),
              "ru"
            )
      );

  const slots =
    [...new Set(
      rows
        .map(
          x =>
            String(x.slot || "")
        )
        .filter(Boolean)
    )]
      .sort();

  const filtered =
    rows.filter(
      positionFilterPass
    );

  const donutData =
    genericDonutData(
      filtered,
      x => slotLabel(x.slot),
      positionMetricValue,
      8
    );

  box.innerHTML =
    kpiGrid([
      ["Строк анализа", number(s.rows)],
      ["После фильтра", number(filtered.length)],
      ["Order", decimal(s.order_conversions)],
      ["Опросы", decimal(s.survey_conversions)],
    ])
    +
    `
      <div style="
        display:flex;
        gap:8px;
        flex-wrap:wrap;
        margin-bottom:14px;
      ">
        <select
          data-position-filter="campaign"
          style="
            min-width:240px;
            background:#091525;
            color:#dce7f2;
            border:1px solid #20354e;
            border-radius:8px;
            padding:9px 10px;
          "
        >
          <option value="all">Все кампании</option>
          ${
            campaigns
              .map(
                ([id, name]) => `
                  <option
                    value="${esc(id)}"
                    ${
                      POSITION_FILTERS.campaign === id
                        ? "selected"
                        : ""
                    }
                  >
                    ${esc(name)}
                  </option>
                `
              )
              .join("")
          }
        </select>

        <select
          data-position-filter="slot"
          style="
            background:#091525;
            color:#dce7f2;
            border:1px solid #20354e;
            border-radius:8px;
            padding:9px 10px;
          "
        >
          <option value="all">Все блоки</option>
          ${
            slots
              .map(
                value => `
                  <option
                    value="${esc(value)}"
                    ${
                      POSITION_FILTERS.slot === value
                        ? "selected"
                        : ""
                    }
                  >
                    ${esc(slotLabel(value))}
                  </option>
                `
              )
              .join("")
          }
        </select>

        <input
          type="number"
          data-position-filter="minClicks"
          value="${esc(POSITION_FILTERS.minClicks)}"
          placeholder="Клики ≥"
          style="
            width:120px;
            background:#091525;
            color:#dce7f2;
            border:1px solid #20354e;
            border-radius:8px;
            padding:9px 10px;
          "
        >

        <input
          type="number"
          data-position-filter="minOrder"
          value="${esc(POSITION_FILTERS.minOrder)}"
          placeholder="Order ≥"
          style="
            width:120px;
            background:#091525;
            color:#dce7f2;
            border:1px solid #20354e;
            border-radius:8px;
            padding:9px 10px;
          "
        >

        <input
          type="number"
          data-position-filter="minCost"
          value="${esc(POSITION_FILTERS.minCost)}"
          placeholder="Расход ≥"
          style="
            width:130px;
            background:#091525;
            color:#dce7f2;
            border:1px solid #20354e;
            border-radius:8px;
            padding:9px 10px;
          "
        >

        <select
          id="positionMetricSelect"
          style="
            margin-left:auto;
            background:#091525;
            color:#dce7f2;
            border:1px solid #20354e;
            border-radius:8px;
            padding:9px 10px;
          "
        >
          ${
            [
              ["cost", "Pie: расход"],
              ["clicks", "Pie: клики"],
              ["order_conversions", "Pie: Order"],
              ["webinar_conversions", "Pie: вебинары"],
              ["survey_conversions", "Pie: опросы"],
            ]
              .map(
                ([value, label]) => `
                  <option
                    value="${value}"
                    ${
                      POSITION_METRIC === value
                        ? "selected"
                        : ""
                    }
                  >
                    ${esc(label)}
                  </option>
                `
              )
              .join("")
          }
        </select>
      </div>

      <div style="
        display:grid;
        grid-template-columns:minmax(300px,520px);
        margin-bottom:16px;
      ">
        ${
          genericDonut(
            "Распределение по блокам поиска",
            donutData,
            positionMetricLabel()
          )
        }
      </div>

      <div class="note" style="margin-bottom:12px">
        Расход при AvgTrafficVolume ≥ 80:
        <strong>${money(s.high_traffic_volume_spend)}</strong>
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
        "Клики",
        "Расход",
      ],
      filtered
        .slice(0, 500)
        .map(
          x => `
            <tr>
              <td><strong>${esc(x.campaign_name)}</strong></td>
              <td>${esc(slotLabel(x.slot))}</td>
              <td>${decimal(x.avg_traffic_volume)}</td>
              <td>${x.avg_effective_bid ? money(x.avg_effective_bid) : "—"}</td>
              <td>${x.cpc ? money(x.cpc) : "—"}</td>
              <td>${decimal(x.order_conversions)}</td>
              <td>${x.order_cpa ? money(x.order_cpa) : "—"}</td>
              <td>${decimal(x.webinar_conversions)}</td>
              <td>${decimal(x.survey_conversions)}</td>
              <td>${number(x.clicks)}</td>
              <td>${money(x.cost)}</td>
            </tr>
          `
        )
        .join("")
    );
}


/* ============================== AUCTION INTELLIGENCE ============================== */

function auctionSignalLabel(value) {
  return ({
    below_search_entry:
      "🔴 Ниже входа в поиск",

    auction_heating:
      "🟠 Аукцион дорожает",

    premium_expensive:
      "🟡 Большой gap до премиума",

    rarely_served:
      "🟡 RARELY_SERVED",

    normal:
      "🟢 Норма",

    limited_data:
      "⚪ Ограниченные данные",
  })[value]
  || value
  || "—";
}

function signedPct(value) {
  if (
    value === null
    || value === undefined
    || Number.isNaN(
      Number(value)
    )
  ) {
    return "—";
  }

  const n =
    Number(value);

  return `${
    n > 0
      ? "+"
      : ""
  }${n.toFixed(1)}%`;
}

function renderAuction() {
  const box =
    document.getElementById(
      "auctionBody"
    );

  if (!box) return;

  const data =
    DATA.auction_intelligence
    || {};

  const rows =
    (data.rows || [])
      .filter(campaignPass);

  const s =
    data.summary
    || {};

  if (!rows.length) {
    box.innerHTML =
      moduleEmpty(
        "Bids.get не вернул аукционные данные. Это может происходить для кампаний, где поиск отключён, или при отсутствии подходящих ключей."
      );
    return;
  }

  box.innerHTML =
    kpiGrid([
      ["Ключей", number(s.keywords)],
      [
        "Ниже входа",
        number(s.below_search_entry)
      ],
      [
        "Аукцион дорожает",
        number(s.auction_heating)
      ],
      [
        "Большой gap до премиума",
        number(s.premium_expensive)
      ],
    ])
    +
    `<div class="note" style="margin-bottom:12px">
      ${esc(data.note || "")}
      <strong>MinSearchPrice</strong> — минимальная цена входа в поиск.
      <strong>Premium required bid</strong> — ориентир ставки для премиального блока.
      Денежные значения Bids API уже приведены из micros в ₽.
      Параметр IncludeVAT относится к Reports API; аукционные ставки Bids.get
      показываются как значения, которые возвращает сервис ставок.
    </div>`
    +
    table(
      [
        "Ключ",
        "Кампания",
        "Serving",
        "Текущая ставка",
        "Цена входа",
        "Текущая цена клика",
        "Ставка для премиума",
        "Gap до премиума",
        "Медиана конкурентов",
        "Δ текущей цены",
        "РСЯ 50%",
        "Сигнал",
      ],
      rows
        .slice(0, 1000)
        .map(
          x => `
            <tr>
              <td>
                <strong>${esc(x.keyword || `ID ${x.keyword_id}`)}</strong>
              </td>

              <td>
                ${esc(x.campaign_name || x.campaign_id || "—")}
              </td>

              <td>
                ${esc(x.serving_status || "—")}
              </td>

              <td>
                ${x.bid ? money(x.bid) : "—"}
              </td>

              <td>
                ${x.min_search_price ? money(x.min_search_price) : "—"}
              </td>

              <td>
                ${x.current_search_price ? money(x.current_search_price) : "—"}
              </td>

              <td>
                ${x.premium_required_bid ? money(x.premium_required_bid) : "—"}
              </td>

              <td>
                ${
                  x.premium_gap_pct == null
                    ? "—"
                    : signedPct(x.premium_gap_pct)
                }
              </td>

              <td>
                ${x.competitor_bid_median ? money(x.competitor_bid_median) : "—"}
              </td>

              <td>
                ${signedPct(x.current_search_price_change_pct)}
              </td>

              <td>
                ${
                  x.context_coverage_50?.price
                    ? `${money(x.context_coverage_50.price)} · ${decimal(x.context_coverage_50.probability)}%`
                    : "—"
                }
              </td>

              <td>
                ${esc(auctionSignalLabel(x.signal))}
              </td>
            </tr>
          `
        )
        .join("")
    );
}


/* ============================== DELIVERY DIAGNOSTICS ============================== */

function deliveryDiagnosisLabel(value) {
  return ({
    demand_exists_no_delivery:
      "🔴 Спрос есть, показов нет",

    no_search_demand:
      "⚪ Нет прогнозного спроса",

    rarely_served:
      "🟡 RARELY_SERVED",

    inactive_or_moderation:
      "🟡 Неактивен / модерация",

    delivering:
      "🟢 Показы идут",

    forecast_unavailable:
      "⚪ Прогноз недоступен",
  })[value]
  || value
  || "—";
}

function yesNoLabel(value) {
  if (value === "YES") {
    return "Да";
  }

  if (value === "NO") {
    return "Нет";
  }

  return "—";
}

function renderDelivery() {
  const box =
    document.getElementById(
      "deliveryBody"
    );

  if (!box) return;

  const data =
    DATA.delivery_diagnostics
    || {};

  const rows =
    (data.rows || [])
      .filter(campaignPass);

  const s =
    data.summary
    || {};

  if (!rows.length) {
    box.innerHTML =
      moduleEmpty(
        "Диагностика показов недоступна: KeywordsResearch.hasSearchVolume не вернул данные."
      );
    return;
  }

  box.innerHTML =
    kpiGrid([
      ["Ключей", number(s.keywords)],
      [
        "Спрос есть, показов нет",
        number(s.demand_exists_no_delivery)
      ],
      [
        "Нет поискового спроса",
        number(s.no_search_demand)
      ],
      [
        "RARELY_SERVED",
        number(s.rarely_served)
      ],
    ])
    +
    `<div class="note" style="margin-bottom:12px">
      ${esc(data.note || "")}
      Проверено региональных конфигураций:
      <strong>${number(s.region_configs_checked)}</strong>.
      ${
        Number(
          s.region_configs_skipped_due_to_rate_limit
          || 0
        ) > 0
          ? `Ещё ${number(s.region_configs_skipped_due_to_rate_limit)} конфигураций пропущено, чтобы не превысить лимит hasSearchVolume.`
          : ""
      }
    </div>`
    +
    table(
      [
        "Ключ",
        "Группа",
        "State",
        "ServingStatus",
        "Спрос",
        "Desktop",
        "Mobile",
        "Tablet",
        "Показы 60д",
        "Клики 60д",
        "Расход 60д",
        "Диагноз",
      ],
      rows
        .slice(0, 1500)
        .map(
          x => `
            <tr>
              <td>
                <strong>${esc(x.keyword)}</strong>
              </td>

              <td>
                ${esc(x.ad_group_name || x.ad_group_id || "—")}
              </td>

              <td>
                ${esc(x.state || "—")}
              </td>

              <td>
                ${esc(x.serving_status || "—")}
              </td>

              <td>
                ${yesNoLabel(x.has_search_volume)}
              </td>

              <td>
                ${yesNoLabel(x.desktop_search_volume)}
              </td>

              <td>
                ${yesNoLabel(x.mobile_search_volume)}
              </td>

              <td>
                ${yesNoLabel(x.tablet_search_volume)}
              </td>

              <td>
                ${number(x.impressions_60d)}
              </td>

              <td>
                ${number(x.clicks_60d)}
              </td>

              <td>
                ${money(x.cost_60d)}
              </td>

              <td>
                ${esc(deliveryDiagnosisLabel(x.diagnosis))}
              </td>
            </tr>
          `
        )
        .join("")
    );
}


/* ============================== CHANGE INTELLIGENCE ============================== */

function changeLabels(values) {
  if (!values?.length) {
    return "—";
  }

  const map = {
    SELF:
      "Настройки кампании",

    CHILDREN:
      "Группы / объявления / ключи",

    STAT:
      "Пересчёт статистики",
  };

  return values
    .map(
      x => map[x] || x
    )
    .join(", ");
}

function renderChanges() {
  const box =
    document.getElementById(
      "changesBody"
    );

  if (!box) return;

  const data =
    DATA.change_intelligence
    || {};

  const rows =
    (data.rows || [])
      .filter(campaignPass);

  const s =
    data.summary
    || {};

  box.innerHTML =
    kpiGrid([
      [
        "Изменённых кампаний",
        number(s.changed_campaigns)
      ],
      [
        "Настройки кампании",
        number(s.campaign_settings)
      ],
      [
        "Дочерние объекты",
        number(s.child_changes)
      ],
      [
        "Пересчёты статистики",
        number(s.statistics_corrections)
      ],
    ])
    +
    `<div class="note" style="margin-bottom:12px">
      Проверено с:
      <strong>${esc(data.checked_since || "—")}</strong>.
      Новый Changes timestamp:
      <strong>${esc(data.timestamp || "—")}</strong>.
      Если есть <strong>BorderDate</strong>, ранее сохранённая статистика после этой даты могла быть скорректирована Яндексом.
    </div>`
    +
    (
      rows.length
        ? table(
            [
              "Кампания",
              "Что изменилось",
              "Поля snapshot",
              "BorderDate",
              "Группы в batch",
              "Объявления в batch",
            ],
            rows
              .map(
                x => `
                  <tr>
                    <td>
                      <strong>${esc(x.campaign_name)}</strong>
                    </td>

                    <td>
                      ${esc(changeLabels(x.changes_in))}
                    </td>

                    <td>
                      ${
                        x.changed_fields_from_snapshot?.length
                          ? esc(
                              x.changed_fields_from_snapshot.join(", ")
                            )
                          : "—"
                      }
                    </td>

                    <td>
                      ${
                        x.border_date
                          ? `<strong style="color:#ffb65c">${esc(x.border_date)}</strong>`
                          : "—"
                      }
                    </td>

                    <td>
                      ${number(x.modified_ad_group_ids_in_batch?.length || 0)}
                    </td>

                    <td>
                      ${number(x.modified_ad_ids_in_batch?.length || 0)}
                    </td>
                  </tr>
                `
              )
              .join("")
          )
        : moduleEmpty(
            "С момента предыдущей проверки Changes API изменений не обнаружено."
          )
    );
}


/* ============================== CONFIGURATION AUDIT ============================== */

function modifierTypeLabel(value) {
  return ({
    MOBILE_ADJUSTMENT:
      "Mobile",

    TABLET_ADJUSTMENT:
      "Tablet",

    DESKTOP_ADJUSTMENT:
      "Desktop + Smart TV",

    DESKTOP_ONLY_ADJUSTMENT:
      "Desktop only",

    DEMOGRAPHICS_ADJUSTMENT:
      "Пол / возраст",

    RETARGETING_ADJUSTMENT:
      "Аудитория / ретаргетинг",

    REGIONAL_ADJUSTMENT:
      "Регион",

    VIDEO_ADJUSTMENT:
      "Видео",

    SMART_AD_ADJUSTMENT:
      "Smart ad",

    SERP_LAYOUT_ADJUSTMENT:
      "Размещение в поиске",

    INCOME_GRADE_ADJUSTMENT:
      "Платежеспособность",

    AD_GROUP_ADJUSTMENT:
      "Группа объявлений",
  })[value]
  || value
  || "—";
}

function auditStatusLabel(value) {
  return ({
    conflict_raise:
      "🔴 Повышаем слабый сегмент",

    conflict_lower:
      "🟠 Понижаем сильный сегмент",

    ok:
      "🟢 Без явного конфликта",

    no_performance_match:
      "⚪ Нет сопоставимого разреза",

    disabled:
      "⚫ Выключено",
  })[value]
  || value
  || "—";
}

function modifierParameters(
  parameters
) {
  if (
    !parameters
    || typeof parameters !== "object"
  ) {
    return "—";
  }

  const rows =
    Object.entries(
      parameters
    )
      .filter(
        ([key]) =>
          key !== "BidModifier"
          && key !== "Enabled"
      );

  if (!rows.length) {
    return "—";
  }

  return rows
    .map(
      ([key, value]) =>
        `${key}: ${
          typeof value === "object"
            ? JSON.stringify(value)
            : value
        }`
    )
    .join(" · ");
}

function renderConfigurationAudit() {
  const box =
    document.getElementById(
      "configAuditBody"
    );

  if (!box) return;

  const data =
    DATA.configuration_audit
    || {};

  const rows =
    (data.rows || [])
      .filter(campaignPass);

  const s =
    data.summary
    || {};

  if (!rows.length) {
    box.innerHTML =
      moduleEmpty(
        "BidModifiers.get не вернул корректировки для текущих кампаний."
      );
    return;
  }

  box.innerHTML =
    kpiGrid([
      ["Корректировок", number(s.modifiers)],
      ["Уровень кампании", number(s.campaign_level)],
      [
        "Повышаем слабые",
        number(s.conflicts_raise)
      ],
      [
        "Понижаем сильные",
        number(s.conflicts_lower)
      ],
    ])
    +
    `<div class="note" style="margin-bottom:12px">
      ${esc(data.note || "")}
      Коэффициент <strong>130%</strong> означает множитель <strong>×1.30</strong>,
      70% — <strong>×0.70</strong>.
    </div>`
    +
    table(
      [
        "Кампания",
        "Уровень",
        "Тип",
        "Коэффициент",
        "Параметры",
        "Сопоставленный сегмент",
        "Order",
        "CPA Order",
        "Клики",
        "Статус",
      ],
      rows
        .map(
          x => `
            <tr>
              <td>
                <strong>${esc(x.campaign_name || x.campaign_id || "—")}</strong>
              </td>

              <td>
                ${esc(x.level || "—")}
                ${
                  x.ad_group_id
                    ? `<div style="font-size:9px;color:#74889e;margin-top:3px">
                        Group ${esc(x.ad_group_id)}
                      </div>`
                    : ""
                }
              </td>

              <td>
                ${esc(modifierTypeLabel(x.type))}
              </td>

              <td>
                <strong>${number(x.coefficient)}%</strong>
                <div style="font-size:9px;color:#74889e;margin-top:3px">
                  ×${decimal(x.multiplier)}
                </div>
              </td>

              <td style="max-width:340px">
                ${esc(modifierParameters(x.parameters))}
              </td>

              <td>
                ${esc(x.comparison_label || "—")}
              </td>

              <td>
                ${decimal(x.performance?.order_conversions)}
              </td>

              <td>
                ${
                  x.performance?.order_cpa
                    ? money(x.performance.order_cpa)
                    : "—"
                }
              </td>

              <td>
                ${number(x.performance?.clicks)}
              </td>

              <td>
                ${esc(auditStatusLabel(x.audit_status))}
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
    "Creative Lab: точная element-level статистика из экспорта Мастера отчётов или честный API fallback.",
  ],

  keywords: [
    "Ключевые фразы",
    "Эффективность, статусы ключей и аудит минус-фраз.",
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

  auction: [
    "Auction Intelligence",
    "Текущий аукцион по ключевым фразам — данные Bids.get, которых нет в обычном отчёте кампаний.",
  ],

  delivery: [
    "Delivery Diagnostics",
    "Отделяем отсутствие спроса от проблем с доставкой рекламы через hasSearchVolume.",
  ],

  changes: [
    "Change Intelligence",
    "Изменения объектов и ретроспективные пересчёты статистики через Changes API.",
  ],

  configaudit: [
    "Configuration Audit",
    "Фактические BidModifiers и автоматическая проверка конфликтующих корректировок.",
  ],
};

function showSection(id) {
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
          button.dataset.section === id
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
    TITLES[id];

  if (title) {
    const heading =
      document.getElementById(
        "pageTitle"
      );

    const subtitle =
      document.getElementById(
        "pageSubtitle"
      );

    if (heading) {
      heading.textContent =
        title[0];
    }

    if (subtitle) {
      subtitle.textContent =
        title[1];
    }
  }
}

document.addEventListener(
  "click",
  event => {
    if (
      event.target.closest(
        "#campaignFilterToggle"
      )
    ) {
      CAMPAIGN_FILTER_OPEN =
        !CAMPAIGN_FILTER_OPEN;

      ensureCampaignFilterUI();
      return;
    }

    const campaignAction =
      event.target.closest(
        "[data-campaign-action]"
      );

    if (campaignAction) {
      GLOBAL_CAMPAIGN_FILTER.clear();
      CAMPAIGN_FILTER_OPEN = false;
      ORDER_OVERVIEW_CAMPAIGN = "all";
      rerenderAnalytics();
      return;
    }

    const overviewTab =
      event.target.closest(
        "[data-overview-tab]"
      );

    if (overviewTab) {
      OVERVIEW_TAB =
        overviewTab.dataset.overviewTab
        || "summary";

      ensureOverviewTabs();
      renderOverviewOrders();
      return;
    }

    const searchTab =
      event.target.closest(
        "[data-search-insight-tab]"
      );

    if (searchTab) {
      SEARCH_INSIGHT_TAB =
        searchTab.dataset.searchInsightTab
        || "queries";

      renderQueries();
      return;
    }

    const nav =
      event.target.closest(
        ".nav[data-section]"
      );

    if (nav) {
      showSection(
        nav.dataset.section
      );
      return;
    }

    const goto =
      event.target.closest(
        "[data-goto]"
      );

    if (goto) {
      showSection(
        goto.dataset.goto
      );
      return;
    }

    const alertFilter =
      event.target.closest(
        "#alertFilters [data-filter]"
      );

    if (alertFilter) {
      ALERT_FILTER =
        alertFilter.dataset.filter
        || "all";

      renderAlerts();
      return;
    }

    const keywordTab =
      event.target.closest(
        "[data-keyword-tab]"
      );

    if (keywordTab) {
      KEYWORD_SUBTAB =
        keywordTab.dataset.keywordTab
        || "performance";

      renderKeywords();
      return;
    }

    const audienceFilter =
      event.target.closest(
        "[data-audience-filter][data-audience-value]"
      );

    if (audienceFilter) {
      const field =
        audienceFilter.dataset.audienceFilter;

      const value =
        audienceFilter.dataset.audienceValue;

      const set =
        AUDIENCE_FILTERS[field];

      if (set) {
        if (set.has(value)) {
          set.delete(value);
        } else {
          set.add(value);
        }

        renderAudience();
      }

      return;
    }

    if (
      event.target.closest(
        "#audienceResetFilters"
      )
    ) {
      Object.values(
        AUDIENCE_FILTERS
      ).forEach(
        set => set.clear()
      );

      renderAudience();
    }
  }
);

document.addEventListener(
  "change",
  event => {
    if (
      event.target?.id
      === "creativeAttributionSelect"
    ) {
      CREATIVE_ATTRIBUTION_FILTER =
        event.target.value
        || "all";

      renderCreatives();
      return;
    }

    const globalCampaign =
      event.target?.closest?.(
        "[data-global-campaign-id]"
      );

    if (globalCampaign) {
      const id =
        String(
          globalCampaign.dataset.globalCampaignId
          || ""
        );

      if (
        GLOBAL_CAMPAIGN_FILTER.size === 0
      ) {
        for (
          const campaign
          of campaignCatalog()
        ) {
          GLOBAL_CAMPAIGN_FILTER.add(
            campaign.id
          );
        }
      }

      if (
        globalCampaign.checked
      ) {
        GLOBAL_CAMPAIGN_FILTER.add(
          id
        );
      } else {
        GLOBAL_CAMPAIGN_FILTER.delete(
          id
        );
      }

      const allIds =
        campaignCatalog()
          .map(
            x => x.id
          );

      if (
        allIds.length
        && allIds.every(
          id =>
            GLOBAL_CAMPAIGN_FILTER.has(
              id
            )
        )
      ) {
        GLOBAL_CAMPAIGN_FILTER.clear();
      }

      if (
        ORDER_OVERVIEW_CAMPAIGN !== "all"
        && GLOBAL_CAMPAIGN_FILTER.size
        && !GLOBAL_CAMPAIGN_FILTER.has(
          ORDER_OVERVIEW_CAMPAIGN
        )
      ) {
        ORDER_OVERVIEW_CAMPAIGN = "all";
      }

      rerenderAnalytics();
      return;
    }

    if (
      event.target?.id
      === "orderOverviewCampaign"
    ) {
      ORDER_OVERVIEW_CAMPAIGN =
        event.target.value
        || "all";

      renderOverviewOrders();
      return;
    }

    if (
      event.target?.id
      === "placementSortSelect"
    ) {
      PLACEMENT_SORT =
        event.target.value
        || "cost";

      renderPlacements();
      return;
    }

    if (
      event.target?.id
      === "placementSortDir"
    ) {
      PLACEMENT_SORT_DIR =
        event.target.value
        || "desc";

      renderPlacements();
      return;
    }

    if (
      event.target?.id
      === "creativeTypeSelect"
    ) {
      CREATIVE_TYPE_FILTER =
        event.target.value
        || "all";

      renderCreatives();
      return;
    }

    if (
      event.target?.id
      === "creativeNetworkSelect"
    ) {
      CREATIVE_NETWORK_FILTER =
        event.target.value
        || "all";

      renderCreatives();
      return;
    }

    if (
      event.target?.id
      === "audienceMetricSelect"
    ) {
      AUDIENCE_METRIC =
        event.target.value
        || "cost";

      renderAudience();
      return;
    }

    if (
      event.target?.id
      === "geoMetricSelect"
    ) {
      GEO_METRIC =
        event.target.value
        || "cost";

      renderGeo();
      return;
    }

    if (
      event.target?.id
      === "positionMetricSelect"
    ) {
      POSITION_METRIC =
        event.target.value
        || "cost";

      renderPositions();
      return;
    }

    const placementFilter =
      event.target?.closest?.(
        "[data-placement-filter]"
      );

    if (placementFilter) {
      PLACEMENT_FILTERS[
        placementFilter.dataset.placementFilter
      ] = placementFilter.value;

      renderPlacements();
      return;
    }

    const geoFilter =
      event.target?.closest?.(
        "[data-geo-filter]"
      );

    if (geoFilter) {
      GEO_FILTERS[
        geoFilter.dataset.geoFilter
      ] =
        geoFilter.type === "checkbox"
          ? geoFilter.checked
          : geoFilter.value;

      renderGeo();
      return;
    }

    const positionFilter =
      event.target?.closest?.(
        "[data-position-filter]"
      );

    if (positionFilter) {
      POSITION_FILTERS[
        positionFilter.dataset.positionFilter
      ] = positionFilter.value;

      renderPositions();
    }
  }
);

document.addEventListener(
  "input",
  event => {
    const placementFilter =
      event.target?.closest?.(
        'input[data-placement-filter]'
      );

    if (placementFilter) {
      PLACEMENT_FILTERS[
        placementFilter.dataset.placementFilter
      ] = placementFilter.value;

      renderPlacements();
      return;
    }

    const geoFilter =
      event.target?.closest?.(
        'input[data-geo-filter]:not([type="checkbox"])'
      );

    if (geoFilter) {
      GEO_FILTERS[
        geoFilter.dataset.geoFilter
      ] = geoFilter.value;

      renderGeo();
      return;
    }

    const positionFilter =
      event.target?.closest?.(
        'input[data-position-filter]'
      );

    if (positionFilter) {
      POSITION_FILTERS[
        positionFilter.dataset.positionFilter
      ] = positionFilter.value;

      renderPositions();
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
      if (!DATA) {
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
    async event => {
      const password =
        sessionStorage.getItem(
          "marketingRadarPassword"
        );

      if (!password) {
        return;
      }

      const button =
        event.currentTarget;

      const oldText =
        button.textContent;

      button.disabled = true;
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
        button.disabled = false;
        button.textContent =
          oldText;
      }
    }
  );

/* ============================== UTIL ============================== */

function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("ru-RU");
}

/* ============================== START ============================== */

start();
