let DATA = null;
let ALERT_FILTER = "all";

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

      if (e.key === "Enter") {
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
  ["attribution", "Атрибуция"],
  ["goals", "Цели"],
  ["media", "Медийка"],
  ["retargeting", "Ретаргетинг"]
];

function ensureAdvancedUI() {
  const nav =
    document.querySelector(
      ".sidebar nav"
    );

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
      "Какие рекламные ключи дают конверсии и сколько стоит результат.",
      "keywordBody"
    ],

    queries: [
      "Search Query Intelligence",
      "Что реально вводят пользователи: новые ключи, минус-слова и семантическое расширение.",
      "queryBody"
    ],

    placements: [
      "Placement Intelligence",
      "Какие площадки РСЯ дают результат, а какие тратят бюджет без конверсий.",
      "placementBody"
    ],

    audience: [
      "Audience Intelligence",
      "Возраст × пол × доход × устройство и кандидаты на корректировки.",
      "audienceBody"
    ],

    geo: [
      "Geo Intelligence",
      "Где фактически находятся пользователи и как это соотносится с таргетингом.",
      "geoBody"
    ],

    positions: [
      "Search Position Economics",
      "Экономика позиций в поиске: объём трафика, ставка, CPC и CPA.",
      "positionBody"
    ],

    attribution: [
      "Attribution Lab",
      "Насколько вывод о кампании зависит от модели атрибуции.",
      "attributionBody"
    ],

    goals: [
      "Goal Intelligence",
      "Какие priority goals реально достигаются и какой вклад они дают.",
      "goalBody"
    ],

    media: [
      "Media Intelligence",
      "Охват, частота и удержание видео для медийных кампаний.",
      "mediaBody"
    ],

    retargeting: [
      "Retargeting Health",
      "Техническое здоровье условий ретаргетинга и доступность сегментов.",
      "retargetingBody"
    ]
  };

  for (
    const [
      id,
      [title, copy, bodyId]
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
      "Расход, показы, клики, CTR, CPC, конверсии и CPA.";
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

  renderAttribution();

  renderGoals();

  renderMedia();

  renderRetargeting();
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

function finalCampaign(c) {
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

  const conversions =
    Number(
      c.conversions
      || 0
    );

  return {
    ...c,

    impressions,

    clicks,

    spend,

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

    cr:
      clicks
        ? conversions
          / clicks
          * 100
        : 0,

    cpa:
      conversions
        ? spend
          / conversions
        : 0
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

        a.conversions +=
          Number(
            c.conversions
            || 0
          );

        return a;
      },
      {
        impressions: 0,
        clicks: 0,
        spend: 0,
        conversions: 0
      }
    );

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

  s.cr =
    s.clicks
      ? s.conversions
        / s.clicks
        * 100
      : 0;

  s.cpa =
    s.conversions
      ? s.spend
        / s.conversions
      : 0;

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

  if (!rows.length) {

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
        )
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

  if (!dates.length) {

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
        )
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

    if (!row.date) {
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

    if (!id) {
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

          conversions:
            0
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

    item.conversions +=
      Number(
        row.conversions
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
      )
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

  if (heroHeadline) {

    heroHeadline.textContent =
      "Marketing Radar работает";
  }

  if (heroCopy) {

    heroCopy.textContent =
      `${
        number(
          snap.campaigns.length
        )
      } кампаний · ${
        money(
          s.spend
        )
      } расходов · ${
        number(
          s.clicks
        )
      } кликов`
      +
      (
        s.conversions
          ? ` · ${
              decimal(
                s.conversions
              )
            } конверсий`
          : ""
      );
  }

  if (health) {

    health.textContent =
      "LIVE";
  }

  const kpis =
    document.getElementById(
      "kpis"
    );

  if (kpis) {

    const items = [
      [
        "Расход",
        money(
          s.spend
        )
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
      ]
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

  if (!box) {
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

            <th>Кампания</th>
            <th>Расход</th>
            <th>Показы</th>
            <th>Клики</th>
            <th>CTR</th>
            <th>CPC</th>
            <th>Конверсии</th>
            <th>CPA</th>

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
                      ${esc(c.name)}
                    </td>

                    <td>
                      ${money(c.spend)}
                    </td>

                    <td>
                      ${number(c.impressions)}
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
                      ${decimal(c.conversions)}
                    </td>

                    <td>
                      ${
                        c.cpa
                          ? money(
                              c.cpa
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

  if (!box) {
    return;
  }

  const s =
    snap.summary;

  const bestCtr =
    snap
      .campaigns
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

  const topSpend =
    snap.campaigns[0];

  const rows = [
    [
      "Средний CPC",
      "По аккаунту",
      s.avg_cpc
        ? money(
            s.avg_cpc
          )
        : "—"
    ],
    [
      "Конверсии",
      `За ${snap.days} дней`,
      decimal(
        s.conversions
      )
    ],
    [
      "Средний CPA",
      "По всем конверсиям",
      s.cpa
        ? money(
            s.cpa
          )
        : "—"
    ]
  ];

  if (topSpend) {

    rows.push([
      "Максимальный расход",
      topSpend.name,
      money(
        topSpend.spend
      )
    ]);
  }

  if (bestCtr) {

    rows.push([
      "Лучший CTR",
      bestCtr.name,
      pct(
        bestCtr.ctr
      )
    ]);
  }

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
  const signals = [];

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

  const r =
    DATA
      .retargeting
      ?.summary
    || {};

  const at =
    DATA
      .attribution
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
        }.`
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
        }.`
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
        "Сегменты с CPA заметно ниже среднего — кандидаты на ручную проверку корректировок."
    });
  }

  if (
    Number(
      r.unavailable
      || 0
    ) > 0
  ) {

    signals.push({
      severity:
        "critical",

      label:
        "РЕТАРГЕТИНГ",

      title:
        `${
          number(
            r.unavailable
          )
        } недоступных условий`,

      text:
        "В условиях есть удалённые или недоступные цели/сегменты."
    });
  }

  if (
    Number(
      at.model_sensitive
      || 0
    ) > 0
  ) {

    signals.push({
      severity:
        "warning",

      label:
        "АТРИБУЦИЯ",

      title:
        `${
          number(
            at.model_sensitive
          )
        } кампаний зависят от модели атрибуции`,

      text:
        "Вывод об эффективности заметно меняется между LC, FCCD, LSCCD и AUTO."
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

  if (!box) {
    return;
  }

  const signals =
    advancedSignals();

  if (!signals.length) {

    const c =
      snap.campaigns;

    const s =
      snap.summary;

    if (c[0]) {

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
          } — максимальный расход среди кампаний.`
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

    if (highCpc) {

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
          }.`
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

    if (bestCtr) {

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
          }.`
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

  const alerts = [];

  for (
    const c
    of snap.campaigns
  ) {

    if (
      c.conversions
      === 0
      &&
      c.clicks
      >= 20
      &&
      c.spend
      >= 1000
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
          }`
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
      c.clicks
      >= 5
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
          } кликов`
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
        signal.label
    });
  }

  return alerts;
}

function renderAlerts() {
  const box =
    document.getElementById(
      "allAlerts"
    );

  if (!box) {
    return;
  }

  const alerts =
    buildAlerts();

  const badge =
    document.getElementById(
      "navAlertCount"
    );

  if (badge) {

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

  if (!box) {
    return;
  }

  const snap =
    overviewSnapshot();

  const s =
    snap.summary;

  function rec(c) {

    if (
      c.conversions
      === 0
      &&
      c.clicks
      >= 20
    ) {

      return (
        "Проверить: расход без конверсий"
      );
    }

    if (
      c.cpa
      &&
      s.cpa
      &&
      c.cpa
      <
      s.cpa
      *
      .8
    ) {

      return (
        "Потенциал для масштабирования"
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

    if (
      s.ctr
      &&
      c.ctr
      >
      s.ctr
      *
      1.25
    ) {

      return (
        "Сильный CTR"
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

            <th>Кампания</th>
            <th>Расход</th>
            <th>Доля</th>
            <th>CTR</th>
            <th>CPC</th>
            <th>Конверсии</th>
            <th>CPA</th>
            <th>Сигнал</th>

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
                      ${esc(c.name)}
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
                      ${decimal(c.conversions)}
                    </td>

                    <td>
                      ${
                        c.cpa
                          ? money(
                              c.cpa
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
      ]
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

  if (!box) {
    return;
  }

  const rows =
    DATA.creatives
    || [];

  if (!rows.length) {

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

              </div>

              <p>
                ${
                  esc(
                    c.reason
                    || ""
                  )
                }
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
                        DATA
                          .meta
                          ?.period_days
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

  if (!box) {
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

  if (!rows.length) {

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
        b.conversions
        || 0
      )
      -
      Number(
        a.conversions
        || 0
      )
      ||
      Number(
        a.cpa
        || 0
      )
      -
      Number(
        b.cpa
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
        "С конверсиями",
        number(
          s.with_conversions
          ??
          rows.filter(
            x =>
              Number(
                x.conversions
              ) > 0
          ).length
        )
      ],
      [
        "Конверсии",
        decimal(
          s.total_conversions
          ??
          rows.reduce(
            (
              z,
              x
            ) =>
              z
              +
              Number(
                x.conversions
                || 0
              ),
            0
          )
        )
      ],
      [
        "Средний CPA",
        Number(
          s.avg_cpa
          || 0
        )
          ? money(
              s.avg_cpa
            )
          : "—"
      ]
    ])
    +
    table(
      [
        "#",
        "Ключевая фраза",
        "Конверсии",
        "CPA",
        "CR",
        "Клики",
        "CTR",
        "Расход",
        "Кампании"
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
                ${decimal(x.conversions)}
              </td>

              <td>
                ${
                  x.cpa
                    ? money(
                        x.cpa
                      )
                    : "—"
                }
              </td>

              <td>
                ${
                  pct(
                    x.conversion_rate
                    ??
                    (
                      x.clicks
                        ? x.conversions
                          /
                          x.clicks
                          *
                          100
                        : 0
                    )
                  )
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
        "⚪ Наблюдать"
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

  if (!box) {
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

  if (!rows.length) {

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
        "Кандидаты в минус",
        number(
          s.negative_candidates
        )
      ],
      [
        "Расход кандидатов",
        money(
          s.negative_candidate_spend
        )
      ],
      [
        "Новые ключи",
        number(
          s.new_keyword_candidates
        )
      ]
    ])
    +
    `
      <div
        class="note"
        style="
          margin-bottom:12px;
        "
      >
        Семантическое расширение SYNONYM/RELATED_KEYWORD:
        <strong>
          ${pct(s.semantic_expansion_share)}
        </strong>
        расхода.
        Рекомендации — диагностические,
        перед изменениями их нужно проверить вручную.
      </div>
    `
    +
    table(
      [
        "Запрос",
        "Сработавший ключ",
        "Тип",
        "Конверсии",
        "CPA",
        "Клики",
        "Расход",
        "Рекомендация"
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
                ${decimal(x.conversions)}
              </td>

              <td>
                ${
                  x.cpa
                    ? money(
                        x.cpa
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
        "⚪ Норма"
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

  if (!box) {
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

  if (!rows.length) {

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
        "На проверку",
        number(
          s.waste_candidates
        )
      ],
      [
        "Расход на проверку",
        money(
          s.waste_candidate_spend
        )
      ],
      [
        "Сильных",
        number(
          s.strong_placements
        )
      ]
    ])
    +
    table(
      [
        "Площадка",
        "Сеть",
        "Конверсии",
        "CPA",
        "Клики",
        "Расход",
        "Bounce",
        "Глубина",
        "Статус"
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
                ${decimal(x.conversions)}
              </td>

              <td>
                ${
                  x.cpa
                    ? money(
                        x.cpa
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

function audienceLabel(
  x
) {

  return (
    [
      x.age,
      x.gender,
      x.income_grade,
      x.device
    ]
      .filter(
        Boolean
      )
      .join(
        " · "
      )
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

function renderAudience() {
  const box =
    document.getElementById(
      "audienceBody"
    );

  if (!box) {
    return;
  }

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

  box.innerHTML =
    kpiGrid([
      [
        "Сегментов",
        number(
          s.segments
        )
      ],
      [
        "Потенциал",
        number(
          s.opportunities
        )
      ],
      [
        "Дорогих",
        number(
          s.expensive_segments
        )
      ],
      [
        "CPA аккаунта",
        s.account_cpa
          ? money(
              s.account_cpa
            )
          : "—"
      ]
    ])
    +
    `
      <div
        class="note"
        style="
          margin-bottom:12px;
        "
      >
        Это рекомендации для ручной проверки корректировок ставок,
        а не автоматическое изменение кампаний.
      </div>
    `
    +
    table(
      [
        "Сегмент",
        "Конверсии",
        "CPA",
        "CR",
        "Клики",
        "Расход",
        "Статус",
        "Рекомендация"
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
                  ${
                    esc(
                      audienceLabel(
                        x
                      )
                    )
                  }
                </strong>
              </td>

              <td>
                ${decimal(x.conversions)}
              </td>

              <td>
                ${
                  x.cpa
                    ? money(
                        x.cpa
                      )
                    : "—"
                }
              </td>

              <td>
                ${pct(x.cr)}
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
                    audienceStatus(
                      x
                    )
                  )
                }
              </td>

              <td>
                ${esc(x.recommendation)}
              </td>

            </tr>

          `
        )
        .join("")
    );
}

/* ============================== GEO ============================== */

function renderGeo() {
  const box =
    document.getElementById(
      "geoBody"
    );

  if (!box) {
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

  if (!rows.length) {

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
        "Пар отличается от таргета",
        number(
          s.different_target_pairs
        )
      ],
      [
        "Расход по таким парам",
        money(
          s.different_target_spend
        )
      ],
      [
        "Доля расхода",
        pct(
          s.different_target_share
        )
      ]
    ])
    +
    `
      <div
        class="note"
        style="
          margin-bottom:12px;
        "
      >
        Отличие фактического региона от региона таргетинга
        не означает ошибку автоматически:
        это может быть расширенный геотаргетинг
        или вложенность регионов.
      </div>
    `
    +
    table(
      [
        "Фактический регион",
        "Конверсии",
        "CPA",
        "Клики",
        "CTR",
        "Расход"
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
                ${decimal(x.conversions)}
              </td>

              <td>
                ${
                  x.cpa
                    ? money(
                        x.cpa
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
                Где фактический регион отличается от таргетинга
              </h3>

            </div>

          </div>

          ${
            table(
              [
                "Таргетинг",
                "Фактическое местоположение",
                "Конверсии",
                "CPA",
                "Расход"
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
                        ${decimal(x.conversions)}
                      </td>

                      <td>
                        ${
                          x.cpa
                            ? money(
                                x.cpa
                              )
                            : "—"
                        }
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

function renderPositions() {
  const box =
    document.getElementById(
      "positionBody"
    );

  if (!box) {
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

  if (!rows.length) {

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
        "Расход TV ≥ 80",
        money(
          s.high_traffic_volume_spend
        )
      ],
      [
        "Доля TV ≥ 80",
        pct(
          s.high_traffic_volume_share
        )
      ],
      [
        "Период",
        `${
          DATA
            .meta
            ?.period_days
          || 60
        } дней`
      ]
    ])
    +
    table(
      [
        "Кампания",
        "Блок",
        "Traffic Volume",
        "Ср. ставка",
        "CPC",
        "CPA",
        "CTR",
        "Weighted CTR",
        "Расход"
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
                ${esc(x.slot)}
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
                ${
                  x.cpa
                    ? money(
                        x.cpa
                      )
                    : "—"
                }
              </td>

              <td>
                ${pct(x.ctr)}
              </td>

              <td>
                ${pct(x.weighted_ctr)}
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

/* ============================== ATTRIBUTION ============================== */

function interpretationLabel(
  value
) {

  return (
    {
      assist:
        "🟢 Недооценена Last Click",

      model_sensitive:
        "🟡 Зависит от модели",

      stable:
        "⚪ Стабильна"
    }[
      value
    ]
    ||
    "⚪ Без оценки"
  );
}

function modelConv(
  row,
  model
) {

  return (
    row
      .models
      ?.[model]
      ?.conversions
    ??
    null
  );
}

function renderAttribution() {
  const box =
    document.getElementById(
      "attributionBody"
    );

  if (!box) {
    return;
  }

  const data =
    DATA.attribution
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
        "Attribution Lab недоступен или в отчётах нет конверсионных данных."
      );

    return;
  }

  box.innerHTML =
    kpiGrid([
      [
        "Кампаний",
        number(
          s.campaigns
        )
      ],
      [
        "Зависят от модели",
        number(
          s.model_sensitive
        )
      ],
      [
        "Assist-кампаний",
        number(
          s.assist_campaigns
        )
      ],
      [
        "Стабильных",
        number(
          s.stable_campaigns
        )
      ]
    ])
    +
    `
      <div
        class="note"
        style="
          margin-bottom:12px;
        "
      >
        Stability Score показывает,
        насколько близки результаты разных моделей атрибуции.
        Чем ниже показатель,
        тем опаснее оценивать кампанию только по Last Click.
      </div>
    `
    +
    table(
      [
        "Кампания",
        "LC",
        "FCCD",
        "LSCCD",
        "AUTO",
        "Stability",
        "Интерпретация"
      ],
      rows
        .map(
          x => `

            <tr>

              <td>
                <strong>
                  ${
                    esc(
                      x.campaign_name
                      ||
                      x.campaign_id
                    )
                  }
                </strong>
              </td>

              <td>
                ${
                  modelConv(
                    x,
                    "LC"
                  )
                  == null
                    ? "—"
                    : decimal(
                        modelConv(
                          x,
                          "LC"
                        )
                      )
                }
              </td>

              <td>
                ${
                  modelConv(
                    x,
                    "FCCD"
                  )
                  == null
                    ? "—"
                    : decimal(
                        modelConv(
                          x,
                          "FCCD"
                        )
                      )
                }
              </td>

              <td>
                ${
                  modelConv(
                    x,
                    "LSCCD"
                  )
                  == null
                    ? "—"
                    : decimal(
                        modelConv(
                          x,
                          "LSCCD"
                        )
                      )
                }
              </td>

              <td>
                ${
                  modelConv(
                    x,
                    "AUTO"
                  )
                  == null
                    ? "—"
                    : decimal(
                        modelConv(
                          x,
                          "AUTO"
                        )
                      )
                }
              </td>

              <td>
                ${pct(x.stability_score)}
              </td>

              <td>
                ${
                  esc(
                    interpretationLabel(
                      x.interpretation
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

/* ============================== GOALS ============================== */

function renderGoals() {
  const box =
    document.getElementById(
      "goalBody"
    );

  if (!box) {
    return;
  }

  const data =
    DATA.goals
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
        s.message
        ||
        "Priority goals в настройках кампаний не найдены или модуль недоступен."
      );

    return;
  }

  box.innerHTML =
    kpiGrid([
      [
        "Priority goals",
        number(
          s.goals
        )
      ],
      [
        "С конверсиями",
        number(
          s.goals_with_conversions
        )
      ],
      [
        "Конверсии целей",
        decimal(
          s.total_goal_conversions
        )
      ],
      [
        "Revenue целей",
        money(
          s.total_goal_revenue
        )
      ]
    ])
    +
    `
      <div
        class="note"
        style="
          margin-bottom:12px;
        "
      >
        Direct API отдаёт ID priority goals;
        без отдельного API Метрики их названия
        здесь отображаются как ID цели.
      </div>
    `
    +
    table(
      [
        "Цель",
        "Конверсии",
        "Revenue",
        "Кампаний",
        "Кампании"
      ],
      rows
        .map(
          x => `

            <tr>

              <td>
                <strong>
                  ${
                    esc(
                      x.name
                      ||
                      `Цель ${
                        x.goal_id
                      }`
                    )
                  }
                </strong>
              </td>

              <td>
                ${decimal(x.conversions)}
              </td>

              <td>
                ${money(x.revenue)}
              </td>

              <td>
                ${number(x.campaign_count)}
              </td>

              <td>
                ${
                  esc(
                    (
                      x.campaigns
                      || []
                    )
                      .join(
                        ", "
                      )
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

/* ============================== MEDIA ============================== */

function renderMedia() {
  const box =
    document.getElementById(
      "mediaBody"
    );

  if (!box) {
    return;
  }

  const data =
    DATA.media
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
        s.message
        ||
        "Медийные кампании не найдены или модуль недоступен."
      );

    return;
  }

  box.innerHTML =
    kpiGrid([
      [
        "Медийных кампаний",
        number(
          s.display_campaigns
        )
      ],
      [
        "Frequency ≥ 5",
        number(
          s.high_frequency_campaigns
        )
      ],
      [
        "Видео-строк",
        number(
          s.video_campaign_rows
        )
      ],
      [
        "Период",
        `${
          DATA
            .meta
            ?.period_days
          || 60
        } дней`
      ]
    ])
    +
    table(
      [
        "Кампания",
        "Reach",
        "Frequency",
        "CPM",
        "25%",
        "50%",
        "75%",
        "100%",
        "Cost complete",
        "Расход"
      ],
      rows
        .map(
          x => `

            <tr>

              <td>
                <strong>
                  ${
                    esc(
                      x.campaign_name
                      ||
                      x.campaign_id
                    )
                  }
                </strong>
              </td>

              <td>
                ${number(x.reach)}
              </td>

              <td>
                ${decimal(x.avg_frequency)}
              </td>

              <td>
                ${
                  x.avg_cpm
                    ? money(
                        x.avg_cpm
                      )
                    : "—"
                }
              </td>

              <td>
                ${
                  x.video_views
                    ? pct(
                        x.video_25_rate
                      )
                    : "—"
                }
              </td>

              <td>
                ${
                  x.video_views
                    ? pct(
                        x.video_50_rate
                      )
                    : "—"
                }
              </td>

              <td>
                ${
                  x.video_views
                    ? pct(
                        x.video_75_rate
                      )
                    : "—"
                }
              </td>

              <td>
                ${
                  x.video_views
                    ? pct(
                        x.video_100_rate
                      )
                    : "—"
                }
              </td>

              <td>
                ${
                  x.avg_complete_cost
                    ? money(
                        x.avg_complete_cost
                      )
                    : "—"
                }
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

/* ============================== RETARGETING ============================== */

function renderRetargeting() {
  const box =
    document.getElementById(
      "retargetingBody"
    );

  if (!box) {
    return;
  }

  const data =
    DATA.retargeting
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
        "Условия ретаргетинга не найдены или модуль недоступен."
      );

    return;
  }

  box.innerHTML =
    kpiGrid([
      [
        "Условий",
        number(
          s.lists
        )
      ],
      [
        "Доступно",
        number(
          s.available
        )
      ],
      [
        "Недоступно",
        number(
          s.unavailable
        )
      ],
      [
        "Окно ≥ 365 дней",
        number(
          s.long_windows
        )
      ]
    ])
    +
    table(
      [
        "Условие",
        "Тип",
        "Доступность",
        "Правил",
        "Целей/сегментов",
        "Макс. окно",
        "Scope"
      ],
      rows
        .map(
          x => `

            <tr>

              <td>
                <strong>
                  ${esc(x.name)}
                </strong>
              </td>

              <td>
                ${esc(x.type)}
              </td>

              <td>
                ${
                  x.status
                  === "healthy"
                    ? "🟢 Доступно"
                    : "🔴 Недоступно"
                }
              </td>

              <td>
                ${number(x.rule_count)}
              </td>

              <td>
                ${number(x.goal_segment_count)}
              </td>

              <td>
                ${
                  x.max_membership_days
                    ? `${
                        number(
                          x.max_membership_days
                        )
                      } дн.`
                    : "—"
                }
              </td>

              <td>
                ${
                  esc(
                    x.scope
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

/* ============================== NAV / EVENTS ============================== */

const TITLES = {

  overview: [
    "Обзор рекламы",
    "Сводка и автоматические сигналы из нескольких разрезов Yandex Direct API."
  ],

  alerts: [
    "Аномалии",
    "События и потери, которые требуют ручной проверки."
  ],

  budget: [
    "Budget Optimizer",
    "Анализ расходов, трафика, конверсий и стоимости результата."
  ],

  creatives: [
    "Creative Intelligence",
    "Какие именно визуалы работают лучше остальных."
  ],

  keywords: [
    "Ключевые фразы",
    "Эффективность заданной рекламной семантики."
  ],

  queries: [
    "Search Query Intelligence",
    "Реальные запросы пользователей и рекомендации по семантике."
  ],

  placements: [
    "Placement Intelligence",
    "Качество и результативность площадок РСЯ."
  ],

  audience: [
    "Audience Intelligence",
    "Сегменты аудитории и кандидаты на корректировки."
  ],

  geo: [
    "Geo Intelligence",
    "Фактическое местоположение пользователей против таргетинга."
  ],

  positions: [
    "Search Position Economics",
    "Цена и эффективность поисковых позиций."
  ],

  attribution: [
    "Attribution Lab",
    "Устойчивость результата к модели атрибуции."
  ],

  goals: [
    "Goal Intelligence",
    "Результат по priority goals кампаний."
  ],

  media: [
    "Media Intelligence",
    "Охват, частота и удержание видео."
  ],

  retargeting: [
    "Retargeting Health",
    "Доступность условий ретаргетинга и сегментов."
  ]
};

function showSection(
  id
) {

  document
    .querySelectorAll(
      ".section"
    )
    .forEach(
      s =>
        s.classList.remove(
          "active"
        )
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

  if (title) {

    const h =
      document.getElementById(
        "pageTitle"
      );

    const p =
      document.getElementById(
        "pageSubtitle"
      );

    if (h) {

      h.textContent =
        title[0];
    }

    if (p) {

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

    if (nav) {

      showSection(
        nav.dataset.section
      );

      return;
    }

    const goto =
      e.target.closest(
        "[data-goto]"
      );

    if (goto) {

      showSection(
        goto.dataset.goto
      );

      return;
    }

    const filter =
      e.target.closest(
        "#alertFilters [data-filter]"
      );

    if (filter) {

      ALERT_FILTER =
        filter.dataset.filter
        || "all";

      renderAlerts();
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
    async e => {

      const password =
        sessionStorage.getItem(
          "marketingRadarPassword"
        );

      if (!password) {
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

        console.error(error);

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

  if (!value) {
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
