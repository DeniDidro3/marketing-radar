let DATA = null;
let ALERT_FILTER = "all";
let KEYWORD_SUBTAB = "performance";
let CREATIVE_ATTRIBUTION_FILTER = "all";

const PLACEMENT_FILTERS = {
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
  ["prioritygoals", "Priority Goals"],
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

    prioritygoals: [
      "Priority Goals",
      "На какие именно цели и конверсии настроена оптимизация алгоритма в кампаниях и портфельных стратегиях.",
      "priorityGoalsBody",
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

/* ============================== RENDER ============================== */

function render() {
  if (!DATA) return;

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

  // API-only modules.
  // В v10 функции существовали ниже в файле, но render()
  // их не вызывал, поэтому вкладки создавались пустыми.
  renderPriorityGoals();
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
  const signals = [];

  const q =
    DATA.search_queries?.summary
    || {};

  const p =
    DATA.placements?.summary
    || {};

  const a =
    DATA.audience?.summary
    || {};

  const auction =
    DATA.auction_intelligence?.summary
    || {};

  const delivery =
    DATA.delivery_diagnostics?.summary
    || {};

  const changes =
    DATA.change_intelligence?.summary
    || {};

  const config =
    DATA.configuration_audit?.summary
    || {};

  if (
    Number(
      delivery.demand_exists_no_delivery
      || 0
    ) > 0
  ) {
    signals.push({
      severity: "critical",
      label: "DELIVERY API",
      title:
        `${number(delivery.demand_exists_no_delivery)} ключей: спрос есть, показов нет`,
      text:
        "KeywordsResearch.hasSearchVolume говорит YES, но за период у ключа 0 показов.",
    });
  }

  if (
    Number(
      changes.statistics_corrections
      || 0
    ) > 0
  ) {
    signals.push({
      severity: "warning",
      label: "CHANGES API",
      title:
        `${number(changes.statistics_corrections)} кампаний с пересчётом статистики`,
      text:
        "Яндекс скорректировал ранее полученную статистику; см. BorderDate.",
    });
  }

  if (
    (
      Number(config.conflicts_raise || 0)
      + Number(config.conflicts_lower || 0)
    ) > 0
  ) {
    signals.push({
      severity: "warning",
      label: "BID MODIFIERS",
      title:
        `${
          number(
            Number(config.conflicts_raise || 0)
            + Number(config.conflicts_lower || 0)
          )
        } подозрительных корректировок`,
      text:
        "Направление коэффициента расходится с доступной Order-эффективностью сегмента.",
    });
  }

  if (
    Number(
      auction.below_search_entry
      || 0
    ) > 0
  ) {
    signals.push({
      severity: "critical",
      label: "АУКЦИОН",
      title:
        `${number(auction.below_search_entry)} ключей ниже цены входа в поиск`,
      text:
        "Текущая ставка ниже MinSearchPrice по данным Bids.get.",
    });
  }

  if (
    Number(q.negative_candidates || 0) > 0
  ) {
    signals.push({
      severity: "critical",
      label: "ПОИСКОВЫЕ ЗАПРОСЫ",
      title:
        `${number(q.negative_candidates)} кандидатов в минус-слова`,
      text:
        `Потенциальный неэффективный расход: ${money(q.negative_candidate_spend)}.`,
    });
  }

  if (
    Number(p.waste_candidates || 0) > 0
  ) {
    signals.push({
      severity: "critical",
      label: "ПЛОЩАДКИ РСЯ",
      title:
        `${number(p.waste_candidates)} площадок требуют проверки`,
      text:
        `Расход по кандидатам на исключение: ${money(p.waste_candidate_spend)}.`,
    });
  }

  if (
    Number(a.opportunities || 0) > 0
  ) {
    signals.push({
      severity: "opportunity",
      label: "АУДИТОРИЯ",
      title:
        `${number(a.opportunities)} сильных сегментов`,
      text:
        "Order CPA заметно ниже среднего — кандидаты на ручную проверку корректировок.",
    });
  }

  return signals;
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

function renderBudget() {
  const box =
    document.getElementById(
      "budgetTable"
    );

  if (!box) return;

  const snap = overviewSnapshot();
  const s = snap.summary;

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
      && c.order_cpa < s.order_cpa * 0.8
    ) {
      return "Order CPA ниже среднего — потенциал для масштабирования";
    }

    if (
      s.avg_cpc
      && c.avg_cpc > s.avg_cpc * 1.3
    ) {
      return "Проверить высокий CPC";
    }

    return "Без явного сигнала";
  }

  box.innerHTML = `
    <div style="overflow:auto">
      <table class="table">
        <thead>
          <tr>
            <th>Кампания</th>
            <th>Расход</th>
            <th>Доля</th>
            <th>CPC</th>
            <th>Order</th>
            <th>CPA Order</th>
            <th>Вебинар</th>
            <th>Опрос</th>
            <th>CPA опрос</th>
            <th>Сигнал</th>
          </tr>
        </thead>
        <tbody>
          ${
            snap.campaigns
              .map(
                c => `
                  <tr>
                    <td><strong>${esc(c.name)}</strong></td>
                    <td>${money(c.spend)}</td>
                    <td>
                      ${
                        s.spend
                          ? (c.spend / s.spend * 100).toFixed(1)
                          : "0.0"
                      }%
                    </td>
                    <td>${c.avg_cpc ? money(c.avg_cpc) : "—"}</td>
                    <td>${decimal(c.order_conversions)}</td>
                    <td>${c.order_cpa ? money(c.order_cpa) : "—"}</td>
                    <td>${decimal(c.webinar_conversions)}</td>
                    <td>${decimal(c.survey_conversions)}</td>
                    <td>${c.survey_cpa ? money(c.survey_cpa) : "—"}</td>
                    <td>${esc(rec(c))}</td>
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

function renderCreatives() {
  const box =
    document.getElementById(
      "creativeGrid"
    );

  if (!box) return;

  const allRows =
    [...(DATA.creatives || [])];

  if (!allRows.length) {
    box.innerHTML =
      `<div class="note">Визуальные креативы не найдены.</div>`;
    return;
  }

  const counts = {
    exact:
      allRows.filter(
        x => x.attribution === "exact"
      ).length,

    proxy:
      allRows.filter(
        x => x.attribution === "proxy"
      ).length,

    unattributable:
      allRows.filter(
        x => x.attribution === "unattributable"
      ).length,
  };

  const rows =
    allRows
      .filter(
        item =>
          CREATIVE_ATTRIBUTION_FILTER === "all"
          || item.attribution === CREATIVE_ATTRIBUTION_FILTER
      )
      .sort(
        (a, b) => {
          const priority = {
            exact: 0,
            proxy: 1,
            unattributable: 2,
          };

          const pa =
            priority[a.attribution]
            ?? 9;

          const pb =
            priority[b.attribution]
            ?? 9;

          if (pa !== pb) {
            return pa - pb;
          }

          return (
            Number(b.clicks || 0)
            - Number(a.clicks || 0)
          );
        }
      );

  const limitation =
    DATA.meta?.creative_limitation
    || (
      "Direct Reports не отдаёт CreativeId/AdImageHash как статистическое измерение. "
      + "Если в одном responsive-объявлении несколько картинок, честно разделить между ними клики и расход нельзя."
    );

  box.innerHTML = `
    <div
      style="
        grid-column:1/-1;
        display:flex;
        justify-content:space-between;
        align-items:flex-start;
        gap:14px;
        flex-wrap:wrap;
        padding:15px;
        border:1px solid #20354e;
        border-radius:12px;
        background:#0e1c2e;
        margin-bottom:2px;
      "
    >
      <div style="max-width:820px">
        <strong>
          Статистика теперь не копируется между несколькими креативами
        </strong>

        <div style="
          color:#8ea2bb;
          font-size:11px;
          line-height:1.55;
          margin-top:5px;
        ">
          ${esc(limitation)}
          Для MULTI-ASSET карточек показатели креатива выводятся как «—»,
          а общая статистика объявления показывается только как отдельный контекст,
          не как эффективность конкретной картинки.
        </div>

        <div style="
          display:flex;
          gap:8px;
          flex-wrap:wrap;
          margin-top:10px;
          font-size:10px;
        ">
          ${pill(`EXACT ${counts.exact}`)}
          ${pill(`SINGLE-ASSET ${counts.proxy}`)}
          ${pill(`MULTI-ASSET ${counts.unattributable}`)}
        </div>
      </div>

      <select
        id="creativeAttributionSelect"
        style="
          background:#091525;
          color:#dce7f2;
          border:1px solid #20354e;
          border-radius:9px;
          padding:9px 10px;
        "
      >
        <option value="all" ${
          CREATIVE_ATTRIBUTION_FILTER === "all"
            ? "selected"
            : ""
        }>
          Все креативы
        </option>

        <option value="exact" ${
          CREATIVE_ATTRIBUTION_FILTER === "exact"
            ? "selected"
            : ""
        }>
          Только EXACT
        </option>

        <option value="proxy" ${
          CREATIVE_ATTRIBUTION_FILTER === "proxy"
            ? "selected"
            : ""
        }>
          Только SINGLE-ASSET
        </option>

        <option value="unattributable" ${
          CREATIVE_ATTRIBUTION_FILTER === "unattributable"
            ? "selected"
            : ""
        }>
          Только MULTI-ASSET
        </option>
      </select>
    </div>

    ${
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
              || c.thumbnail_url
              || c.original_url;

            const score =
              c.score == null
                ? "—"
                : c.score;

            const hasIndividualStats =
              c.attribution === "exact"
              || c.attribution === "proxy";

            const contextImpressions =
              Number(
                c.unattributed_impressions
                || 0
              );

            const contextClicks =
              Number(
                c.unattributed_clicks
                || 0
              );

            const contextSpend =
              Number(
                c.unattributed_spend
                || 0
              );

            return `
              <article
                class="creative"
                style="overflow:hidden"
              >
                ${
                  preview
                    ? `
                      <div style="
                        width:100%;
                        aspect-ratio:16/10;
                        border-radius:10px;
                        overflow:hidden;
                        background:#07111f;
                        margin-bottom:16px;
                        display:flex;
                        align-items:center;
                        justify-content:center;
                      ">
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

                <div class="creative-head">
                  <div>
                    <div style="
                      font-size:9px;
                      color:#7990a8;
                      margin-bottom:4px;
                    ">
                      ${esc((c.kind || "creative").toUpperCase())}
                    </div>

                    <h4>
                      ${esc(c.name || `Creative ${c.asset_id || ""}`)}
                    </h4>
                  </div>

                  <span class="fatigue">
                    ${score}
                  </span>
                </div>

                <div style="
                  margin-top:8px;
                  font-size:10px;
                  color:#8ea2bb;
                ">
                  ${esc(c.campaign_name || "")}
                </div>

                <div style="
                  display:flex;
                  gap:6px;
                  flex-wrap:wrap;
                  margin-top:12px;
                ">
                  ${pill(`${icon} ${label}`)}
                  ${pill(c.network || "—")}
                  ${pill(c.asset_type || c.kind || "—")}
                  ${pill(creativeAttributionLabel(c.attribution))}
                </div>

                <div class="stats" style="margin-top:15px">
                  ${mini(
                    "CTR",
                    hasIndividualStats
                      ? pct(c.ctr)
                      : "—"
                  )}

                  ${mini(
                    "CPC",
                    hasIndividualStats && c.avg_cpc
                      ? money(c.avg_cpc)
                      : "—"
                  )}

                  ${mini(
                    "Клики",
                    hasIndividualStats
                      ? number(c.clicks)
                      : "—"
                  )}

                  ${mini(
                    "Расход",
                    hasIndividualStats
                      ? money(c.spend)
                      : "—"
                  )}

                  ${mini(
                    "Order",
                    hasIndividualStats
                      ? decimal(c.order_conversions)
                      : "—"
                  )}

                  ${mini(
                    "Вебинар",
                    hasIndividualStats
                      ? decimal(c.webinar_conversions)
                      : "—"
                  )}

                  ${mini(
                    "Опрос",
                    hasIndividualStats
                      ? decimal(c.survey_conversions)
                      : "—"
                  )}

                  ${mini(
                    "CPA Order",
                    hasIndividualStats && c.order_cpa
                      ? money(c.order_cpa)
                      : "—"
                  )}
                </div>

                <p>
                  ${esc(c.reason || "")}
                </p>

                ${
                  c.attribution === "proxy"
                    ? `
                      <div class="note" style="margin-top:12px">
                        В объявлении ровно один визуальный ассет.
                        Поэтому статистика AdId используется как proxy этого визуала.
                      </div>
                    `
                    : ""
                }

                ${
                  c.attribution === "unattributable"
                    ? `
                      <div class="note" style="margin-top:12px">
                        <strong>
                          Индивидуальные данные этого креатива Direct API не отдаёт.
                        </strong>

                        ${
                          (
                            contextImpressions
                            || contextClicks
                            || contextSpend
                          )
                            ? `
                              <div style="
                                margin-top:6px;
                                color:#8ea2bb;
                              ">
                                Контекст объявлений, где этот визуал присутствовал:
                                ${number(contextImpressions)} показов ·
                                ${number(contextClicks)} кликов ·
                                ${money(contextSpend)} расхода.
                                Эти значения <strong>не являются</strong>
                                статистикой конкретной картинки.
                              </div>
                            `
                            : ""
                        }
                      </div>
                    `
                    : ""
                }
              </article>
            `;
          }
        )
        .join("")
    }
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
    [...(DATA.keywords || [])];

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
    data.rows
    || [];

  const s =
    data.summary
    || {};

  if (!rows.length) {
    box.innerHTML =
      moduleEmpty(
        "Search Query Intelligence недоступен или по запросам нет данных."
      );
    return;
  }

  box.innerHTML =
    kpiGrid([
      ["Реальных запросов", number(s.queries)],
      ["Order", decimal(s.order_conversions)],
      ["Вебинары", decimal(s.webinar_conversions)],
      ["Опросы", decimal(s.survey_conversions)],
    ])
    +
    `<div class="note" style="margin-bottom:12px">
      Кандидатов в минус: <strong>${number(s.negative_candidates)}</strong>.
      Расход кандидатов: <strong>${money(s.negative_candidate_spend)}</strong>.
      Новых ключей: <strong>${number(s.new_keyword_candidates)}</strong>.
    </div>`
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
        .slice(0, 500)
        .map(
          x => `
            <tr>
              <td><strong>${esc(x.query)}</strong></td>
              <td>${esc(x.criterion || x.matched_keyword || "—")}</td>
              <td>${esc(x.match_type)}</td>
              <td>${decimal(x.order_conversions)}</td>
              <td>${x.order_cpa ? money(x.order_cpa) : "—"}</td>
              <td>${decimal(x.webinar_conversions)}</td>
              <td>${decimal(x.survey_conversions)}</td>
              <td>${number(x.clicks)}</td>
              <td>${money(x.cost)}</td>
              <td>${esc(queryRecommendation(x.recommendation))}</td>
            </tr>
          `
        )
        .join("")
    );
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

function renderPlacements() {
  const box =
    document.getElementById(
      "placementBody"
    );

  if (!box) return;

  const data =
    DATA.placements
    || {};

  const rows =
    data.rows
    || [];

  const s =
    data.summary
    || {};

  if (!rows.length) {
    box.innerHTML =
      moduleEmpty(
        "По площадкам РСЯ данных нет или модуль недоступен."
      );
    return;
  }

  const networks =
    [...new Set(
      rows
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
    rows.filter(
      placementFilterPass
    );

  box.innerHTML =
    kpiGrid([
      ["Площадок", number(s.placements)],
      ["После фильтра", number(filtered.length)],
      ["Order", decimal(s.order_conversions)],
      ["Опросы", decimal(s.survey_conversions)],
    ])
    +
    `
      <div
        class="note"
        style="
          margin-bottom:12px;
          ${
            s.goal_data_available === false
              ? "border-color:#7b4a2a;color:#ffb65c;"
              : ""
          }
        "
      >
        ${
          s.goal_data_available === false
            ? "⚠ Direct не вернул goal-specific поля Conversions_* для отчёта по площадкам. Проверь лог `goal_columns_found` после Action."
            : `Goal-specific колонки Direct обнаружены: ${number(s.goal_columns_found || 0)}. Если у площадки стоят нули, это означает, что по выбранным отслеживаемым целям Direct не вернул конверсии для этой площадки.`
        }

        ${
          Number(s.windows_failed || 0) > 0
            ? `<div style="margin-top:6px;color:#ffb65c">
                ⚠ Часть дневных окон площадок не собралась: ${number(s.windows_failed)}.
                Таблица построена по успешно полученным периодам.
              </div>`
            : Number(s.windows_successful_requests || 0) > 0
              ? `<div style="margin-top:6px;color:#52d39a">
                  Площадочный отчёт собран частями: ${number(s.windows_successful_requests)} успешных API-окон.
                </div>`
              : ""
        }
      </div>

      <div style="
        display:grid;
        grid-template-columns:
          minmax(170px,1.5fr)
          minmax(130px,1fr)
          repeat(8,minmax(100px,1fr))
          minmax(130px,1fr);
        gap:7px;
        margin-bottom:10px;
        overflow:auto;
      ">
        ${placementFilterInput(
          "placement",
          "Площадка содержит…",
          PLACEMENT_FILTERS.placement
        )}

        <select
          data-placement-filter="network"
          style="
            background:#091525;
            color:#dce7f2;
            border:1px solid #20354e;
            border-radius:7px;
            padding:7px 8px;
            font-size:9px;
          "
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
          "CPA Order ≤",
          PLACEMENT_FILTERS.maxOrderCpa,
          "number"
        )}

        ${placementFilterInput(
          "minWebinar",
          "Вебинар ≥",
          PLACEMENT_FILTERS.minWebinar,
          "number"
        )}

        ${placementFilterInput(
          "minSurvey",
          "Опрос ≥",
          PLACEMENT_FILTERS.minSurvey,
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

        ${placementFilterInput(
          "maxBounce",
          "Bounce ≤",
          PLACEMENT_FILTERS.maxBounce,
          "number"
        )}

        ${placementFilterInput(
          "minDepth",
          "Глубина ≥",
          PLACEMENT_FILTERS.minDepth,
          "number"
        )}

        <select
          data-placement-filter="status"
          style="
            background:#091525;
            color:#dce7f2;
            border:1px solid #20354e;
            border-radius:7px;
            padding:7px 8px;
            font-size:9px;
          "
        >
          <option value="all">Все статусы</option>
          ${
            [
              ["normal", "Норма"],
              ["strong", "Сильная"],
              ["waste", "Расход без результата"],
              ["bad_traffic", "Низкое качество"],
            ]
              .map(
                ([value, label]) => `
                  <option
                    value="${value}"
                    ${
                      PLACEMENT_FILTERS.status === value
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
      filtered
        .slice(0, 500)
        .map(
          x => `
            <tr>
              <td><strong>${esc(x.placement)}</strong></td>
              <td>${esc(x.external_network || "—")}</td>
              <td>${decimal(x.order_conversions)}</td>
              <td>${x.order_cpa ? money(x.order_cpa) : "—"}</td>
              <td>${decimal(x.webinar_conversions)}</td>
              <td>${decimal(x.survey_conversions)}</td>
              <td>${number(x.clicks)}</td>
              <td>${money(x.cost)}</td>
              <td>${x.sessions ? pct(x.bounce_rate) : "—"}</td>
              <td>${x.sessions ? decimal(x.avg_pageviews) : "—"}</td>
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
    data.rows
    || [];

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
    data.locations
    || [];

  const pairs =
    data.target_presence_pairs
    || [];

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
    data.rows
    || [];

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


/* ============================== PRIORITY GOALS ============================== */

function strategyTypeLabel(value) {
  return ({
    WB_MAXIMUM_CONVERSION_RATE: "Максимум конверсий",
    AVERAGE_CPA: "Средняя CPA",
    AVERAGE_CPA_MULTIPLE_GOALS: "Средняя CPA · несколько целей",
    PAY_FOR_CONVERSION: "Оплата за конверсии",
    PAY_FOR_CONVERSION_MULTIPLE_GOALS: "Оплата за конверсии · несколько целей",
    AVERAGE_CRR: "Средний ДРР",
    PAY_FOR_CONVERSION_CRR: "Оплата за конверсию · ДРР",
    MAX_PROFIT: "Максимум прибыли",
    WB_MAXIMUM_CLICKS: "Максимум кликов",
    AVERAGE_CPC: "Средний CPC",
    HIGHEST_POSITION: "Наивысшая позиция",
    NETWORK_DEFAULT: "Стандартная РСЯ",
    SERVING_OFF: "Показы выключены",
  })[value]
  || value
  || "—";
}

function goalSourceLabel(value) {
  return ({
    strategy_goal: "Конкретный GoalId стратегии",
    priority_goals: "Priority Goals стратегии",
    priority_goals_adjustment: "Priority Goals для автокорректировки",
    no_conversion_goal: "Стратегия не оптимизируется на конверсию",
    unknown: "Точная цель не определена",
  })[value]
  || value
  || "—";
}

function renderGoalList(goals) {
  if (!goals?.length) {
    return "—";
  }

  return goals
    .map(
      goal => {
        const value =
          Number(goal.value_currency || 0);

        return `
          <div style="
            margin:3px 0;
            padding:5px 7px;
            border-radius:7px;
            background:#091525;
            font-size:10px;
          ">
            <strong>${esc(goal.goal_name || `Цель ${goal.goal_id}`)}</strong>
            <span style="color:#7891aa">
              · ID ${esc(goal.goal_id)}
            </span>
            ${
              value > 0
                ? `<span style="color:#52d39a">
                    · ценность ${money(value)}
                  </span>`
                : ""
            }
          </div>
        `;
      }
    )
    .join("");
}

function renderPriorityGoals() {
  const box =
    document.getElementById(
      "priorityGoalsBody"
    );

  if (!box) return;

  const data =
    DATA.priority_goals
    || {};

  const rows =
    data.rows
    || [];

  const s =
    data.summary
    || {};

  if (!rows.length) {
    box.innerHTML =
      moduleEmpty(
        "Campaigns.get / Strategies.get не вернули настройки целей оптимизации."
      );
    return;
  }

  box.innerHTML =
    kpiGrid([
      ["Кампаний", number(s.campaigns)],
      [
        "Строк Поиск/РСЯ",
        number(s.rows)
      ],
      [
        "С явной целью",
        number(s.with_explicit_optimization_goals)
      ],
      [
        "Портфельных",
        number(s.using_portfolio)
      ],
    ])
    +
    `<div class="note" style="margin-bottom:12px">
      ${esc(data.note || "")}
      Значение Priority Goal — это относительная ценность конверсии:
      чем выше значение, тем выше приоритет цели для автоматической оптимизации.
    </div>`
    +
    table(
      [
        "Кампания",
        "Канал",
        "Стратегия",
        "Источник",
        "На какие цели оптимизируется",
        "Все Priority Goals",
        "Атрибуция",
        "Портфель",
      ],
      rows
        .map(
          x => `
            <tr>
              <td>
                <strong>${esc(x.campaign_name)}</strong>
                <div style="
                  margin-top:3px;
                  color:#6f859c;
                  font-size:9px;
                ">
                  ${esc(x.campaign_state || "")}
                </div>
              </td>
              <td>${esc(x.channel)}</td>
              <td>${esc(strategyTypeLabel(x.strategy_type))}</td>
              <td>${esc(goalSourceLabel(x.goal_source))}</td>
              <td style="min-width:260px">
                ${renderGoalList(x.optimization_goals)}
              </td>
              <td style="min-width:260px">
                ${renderGoalList(x.priority_goals)}
              </td>
              <td>${esc(x.attribution_model || "—")}</td>
              <td>
                ${
                  x.strategy_source === "portfolio"
                    ? `
                      <strong>${esc(x.portfolio_strategy_name || "Портфельная стратегия")}</strong>
                      <div style="
                        color:#7891aa;
                        font-size:9px;
                        margin-top:3px;
                      ">
                        ID ${esc(x.portfolio_strategy_id || "—")}
                      </div>
                    `
                    : "Кампания"
                }
              </td>
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
    data.rows
    || [];

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
    data.rows
    || [];

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
    data.rows
    || [];

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
    data.rows
    || [];

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
    "Какие именно визуалы работают лучше остальных.",
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

  prioritygoals: [
    "Priority Goals",
    "Какие цели фактически используются стратегиями и автоматической корректировкой ставок.",
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
