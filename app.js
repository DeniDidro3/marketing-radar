let DATA = null;
let ALERT_FILTER = "all";

const fmt = new Intl.NumberFormat("ru-RU");
const money = value => `${fmt.format(Math.round(Number(value || 0)))} ₽`;
const number = value => fmt.format(Math.round(Number(value || 0)));
const metricNumber = value => Number(value || 0).toLocaleString("ru-RU", { maximumFractionDigits: 2 });
const pct = value => `${Number(value || 0).toFixed(2)}%`;

/* =========================================================
   CRYPTO
========================================================= */

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
  const salt = base64ToBytes(payload.salt);
  const nonce = base64ToBytes(payload.nonce);
  const ciphertext = base64ToBytes(payload.ciphertext);
  const key = await deriveKey(password, salt, payload.iterations);

  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: nonce },
    key,
    ciphertext
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

  const payload = await response.json();

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
        ?.remove();

      render();

    } catch (error) {

      console.error(error);

      document
        .getElementById(
          "loginError"
        )
        .textContent =
          "Неверный пароль или не удалось расшифровать отчёт.";

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

    } catch (error) {

      console.error(error);

      sessionStorage.removeItem(
        "marketingRadarPassword"
      );
    }
  }

  showLogin();
}

/* =========================================================
   MAIN
========================================================= */

function render() {

  if (!DATA) {
    return;
  }

  ensureKeywordsUI();

  prepareStaticCopy();

  renderMeta();

  renderOverview();

  renderAlerts();

  renderBudgetTable();

  renderCreatives();

  renderKeywords();
}

/* =========================================================
   DYNAMIC KEYWORDS SECTION
========================================================= */

function ensureKeywordsUI() {

  const sidebarNav =
    document.querySelector(
      ".sidebar nav"
    );

  if (
    sidebarNav
    &&
    !sidebarNav.querySelector(
      '[data-section="keywords"]'
    )
  ) {

    const button =
      document.createElement(
        "button"
      );

    button.className =
      "nav";

    button.dataset.section =
      "keywords";

    button.textContent =
      "Ключевые фразы";

    sidebarNav.appendChild(
      button
    );
  }

  if (
    !document.getElementById(
      "keywords"
    )
  ) {

    const section =
      document.createElement(
        "section"
      );

    section.id =
      "keywords";

    section.className =
      "section";

    section.innerHTML = `

      <div
        class="section-head top"
      >

        <div>

          <h2>
            Ключевые фразы
          </h2>

          <p>
            Какие рекламные ключи чаще приводят
            к конверсиям и сколько стоит результат.
          </p>

        </div>

      </div>


      <div
        id="keywordKpis"
        class="kpi-grid"
      ></div>


      <div
        id="keywordNote"
        class="note"
        style="
          margin-bottom:12px;
        "
      ></div>


      <div
        class="panel"
      >

        <div
          class="panel-head"
        >

          <h3>
            Рейтинг ключевых фраз
          </h3>

          <p>
            Сортировка по количеству конверсий,
            затем по стоимости конверсии.
          </p>

        </div>


        <div
          id="keywordsTable"
          style="
            overflow:auto;
          "
        ></div>

      </div>

    `;

    const footer =
      document.querySelector(
        "main footer"
      );

    if (footer) {

      footer.parentNode.insertBefore(
        section,
        footer
      );

    } else {

      document
        .querySelector(
          "main"
        )
        ?.appendChild(
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

  const overviewHead =
    document.querySelector(
      "#overview .section-head h3"
    );

  const overviewHeadCopy =
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
      "Краткая сводка по расходам и эффективности рекламы.";
  }

  if (overviewHead) {

    overviewHead.textContent =
      "Что требует внимания";
  }

  if (overviewHeadCopy) {

    overviewHeadCopy.textContent =
      "Сигналы рассчитываются по показателям рекламных кампаний.";
  }
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
}

/* =========================================================
   PERIOD / DATA
========================================================= */

function getSelectedPeriodDays() {

  const value =
    Number(
      document
        .getElementById(
          "periodSelect"
        )
        ?.value
      || 30
    );

  return (
    Number.isFinite(value)
    &&
    value > 0
  )
    ? value
    : 30;
}

function finalizeCampaign(
  campaign
) {

  const impressions =
    Number(
      campaign.impressions
      || 0
    );

  const clicks =
    Number(
      campaign.clicks
      || 0
    );

  const spend =
    Number(
      campaign.spend
      || 0
    );

  const conversions =
    Number(
      campaign.conversions
      || 0
    );

  return {

    ...campaign,

    impressions,

    clicks,

    spend,

    conversions,

    ctr:
      impressions > 0

        ? clicks
          / impressions
          * 100

        : 0,

    avg_cpc:
      clicks > 0

        ? spend
          / clicks

        : 0,

    conversion_rate:
      clicks > 0

        ? conversions
          / clicks
          * 100

        : 0,

    cpa:
      conversions > 0

        ? spend
          / conversions

        : 0,
  };
}

function summarizeCampaigns(
  campaigns
) {

  const impressions =
    campaigns.reduce(
      (
        sum,
        campaign
      ) =>
        sum
        +
        Number(
          campaign.impressions
          || 0
        ),
      0
    );

  const clicks =
    campaigns.reduce(
      (
        sum,
        campaign
      ) =>
        sum
        +
        Number(
          campaign.clicks
          || 0
        ),
      0
    );

  const spend =
    campaigns.reduce(
      (
        sum,
        campaign
      ) =>
        sum
        +
        Number(
          campaign.spend
          || 0
        ),
      0
    );

  const conversions =
    campaigns.reduce(
      (
        sum,
        campaign
      ) =>
        sum
        +
        Number(
          campaign.conversions
          || 0
        ),
      0
    );

  return {

    impressions,

    clicks,

    spend,

    conversions,

    ctr:
      impressions > 0

        ? clicks
          / impressions
          * 100

        : 0,

    avg_cpc:
      clicks > 0

        ? spend
          / clicks

        : 0,

    conversion_rate:
      clicks > 0

        ? conversions
          / clicks
          * 100

        : 0,

    cpa:
      conversions > 0

        ? spend
          / conversions

        : 0,
  };
}

function snapshotFromCampaigns(
  campaigns,
  periodDays
) {

  const normalized =
    [...campaigns]
      .map(
        campaign =>
          finalizeCampaign({

            campaign_id:
              campaign.campaign_id,

            name:
              campaign.name
              ||
              campaign.campaign_name
              ||
              "Без названия",

            impressions:
              Number(
                campaign.impressions
                || 0
              ),

            clicks:
              Number(
                campaign.clicks
                || 0
              ),

            spend:
              Number(
                campaign.spend
                ??
                campaign.cost
                ??
                0
              ),

            conversions:
              Number(
                campaign.conversions
                || 0
              ),
          })
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

    periodDays,

    campaigns:
      normalized,

    summary:
      summarizeCampaigns(
        normalized
      ),
  };
}

function getOverviewSnapshot() {

  const periodDays =
    getSelectedPeriodDays();

  const sourceRows =
    Array.isArray(
      DATA.daily
    )
      ? DATA.daily
      : [];

  if (
    !sourceRows.length
  ) {

    return snapshotFromCampaigns(
      DATA.campaigns
      || [],
      periodDays
    );
  }

  const dates =
    sourceRows
      .map(
        row =>
          String(
            row.date
            || ""
          )
      )
      .filter(
        Boolean
      )
      .sort();

  if (
    !dates.length
  ) {

    return snapshotFromCampaigns(
      DATA.campaigns
      || [],
      periodDays
    );
  }

  const latestDate =
    new Date(
      `${dates[
        dates.length - 1
      ]}T00:00:00Z`
    );

  const startDate =
    new Date(
      latestDate
    );

  startDate.setUTCDate(
    startDate.getUTCDate()
    -
    periodDays
    +
    1
  );

  const campaignMap =
    new Map();

  sourceRows.forEach(
    row => {

      if (
        !row.date
      ) {
        return;
      }

      const date =
        new Date(
          `${row.date}T00:00:00Z`
        );

      if (
        date < startDate
        ||
        date > latestDate
      ) {
        return;
      }

      const id =
        String(
          row.campaign_id
          || ""
        );

      if (
        !id
      ) {
        return;
      }

      if (
        !campaignMap.has(
          id
        )
      ) {

        campaignMap.set(
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
              0,
          }
        );
      }

      const item =
        campaignMap.get(
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
  );

  const campaigns =
    [
      ...campaignMap.values()
    ]
      .map(
        finalizeCampaign
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

    periodDays,

    campaigns,

    summary:
      summarizeCampaigns(
        campaigns
      ),
  };
}

/* =========================================================
   OVERVIEW
========================================================= */

function renderOverview() {

  const snapshot =
    getOverviewSnapshot();

  renderHero(
    snapshot
  );

  renderKPIs(
    snapshot
  );

  renderCampaignTable(
    snapshot
  );

  renderDirectSummary(
    snapshot
  );

  renderOverviewInsights(
    snapshot
  );
}

function renderHero(
  snapshot
) {

  const s =
    snapshot.summary;

  const headline =
    document.getElementById(
      "heroHeadline"
    );

  const copy =
    document.getElementById(
      "heroCopy"
    );

  const health =
    document.getElementById(
      "healthScore"
    );

  if (headline) {

    headline.textContent =
      "Marketing Radar работает";
  }

  if (copy) {

    const conversionPart =
      Number(
        s.conversions
        || 0
      ) > 0

        ? (
          ` · ${
            metricNumber(
              s.conversions
            )
          } конверсий`
        )

        : "";

    copy.textContent =
      `${
        number(
          snapshot
            .campaigns
            .length
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
      } кликов`
      +
      conversionPart;
  }

  if (health) {

    health.textContent =
      "LIVE";
  }
}

function renderKPIs(
  snapshot
) {

  const container =
    document.getElementById(
      "kpis"
    );

  if (
    !container
  ) {
    return;
  }

  const s =
    snapshot.summary;

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

  container.innerHTML =
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
              ${
                escapeHtml(
                  label
                )
              }
            </div>

            <div
              class="value"
            >
              ${
                escapeHtml(
                  value
                )
              }
            </div>

            <div
              class="delta neutral"
            >
              за ${
                snapshot.periodDays
              } дней
            </div>

          </div>

        `
      )
      .join("");
}

function renderCampaignTable(
  snapshot
) {

  const container =
    document.getElementById(
      "campaignTable"
    );

  if (
    !container
  ) {
    return;
  }

  if (
    !snapshot
      .campaigns
      .length
  ) {

    container.innerHTML =
      `
      <div
        class="note"
      >
        Нет данных
        по кампаниям.
      </div>
      `;

    return;
  }

  container.innerHTML = `

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

            <th>
              Конверсии
            </th>

            <th>
              CPA
            </th>

          </tr>

        </thead>

        <tbody>

          ${
            snapshot
              .campaigns
              .map(
                campaign => `

                  <tr>

                    <td>
                      ${
                        escapeHtml(
                          campaign.name
                          ||
                          "Без названия"
                        )
                      }
                    </td>

                    <td>
                      ${
                        money(
                          campaign.spend
                        )
                      }
                    </td>

                    <td>
                      ${
                        number(
                          campaign.impressions
                        )
                      }
                    </td>

                    <td>
                      ${
                        number(
                          campaign.clicks
                        )
                      }
                    </td>

                    <td>
                      ${
                        pct(
                          campaign.ctr
                        )
                      }
                    </td>

                    <td>
                      ${
                        campaign.avg_cpc
                        > 0

                          ? money(
                              campaign.avg_cpc
                            )

                          : "—"
                      }
                    </td>

                    <td>
                      ${
                        metricNumber(
                          campaign.conversions
                        )
                      }
                    </td>

                    <td>
                      ${
                        campaign.cpa
                        > 0

                          ? money(
                              campaign.cpa
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

function renderDirectSummary(
  snapshot
) {

  const container =
    document.getElementById(
      "budgetPreview"
    );

  if (
    !container
  ) {
    return;
  }

  const campaigns =
    snapshot.campaigns;

  const s =
    snapshot.summary;

  const highestSpend =
    campaigns[0];

  const bestCtr =
    campaigns
      .filter(
        campaign =>
          campaign.clicks
          >= 10
      )
      .slice()
      .sort(
        (
          a,
          b
        ) =>
          b.ctr
          -
          a.ctr
      )[0];

  const items = [

    {

      label:
        "Средний CPC",

      meta:
        "По всем кампаниям",

      value:
        s.avg_cpc
        > 0

          ? money(
              s.avg_cpc
            )

          : "—",
    },

    {

      label:
        "Конверсии",

      meta:
        `За ${
          snapshot.periodDays
        } дней`,

      value:
        metricNumber(
          s.conversions
        ),
    },

    {

      label:
        "Средний CPA",

      meta:
        "По всем конверсиям",

      value:
        s.cpa
        > 0

          ? money(
              s.cpa
            )

          : "—",
    },
  ];

  if (
    highestSpend
  ) {

    items.push({

      label:
        "Максимальный расход",

      meta:
        highestSpend.name,

      value:
        money(
          highestSpend.spend
        ),
    });
  }

  if (
    bestCtr
  ) {

    items.push({

      label:
        "Лучший CTR",

      meta:
        bestCtr.name,

      value:
        pct(
          bestCtr.ctr
        ),
    });
  }

  container.innerHTML =
    items
      .map(
        item => `

          <div
            class="budget-item"
          >

            <div>

              <strong>
                ${
                  escapeHtml(
                    item.label
                  )
                }
              </strong>

              <small>
                ${
                  escapeHtml(
                    item.meta
                    || ""
                  )
                }
              </small>

            </div>

            <strong>
              ${
                escapeHtml(
                  item.value
                )
              }
            </strong>

          </div>

        `
      )
      .join("");
}

function renderOverviewInsights(
  snapshot
) {

  const container =
    document.getElementById(
      "priorityAlerts"
    );

  if (
    !container
  ) {
    return;
  }

  const campaigns =
    snapshot.campaigns;

  if (
    !campaigns.length
  ) {

    container.innerHTML =
      `
      <div
        class="note"
      >
        Недостаточно данных
        для сигналов.
      </div>
      `;

    return;
  }

  const s =
    snapshot.summary;

  const highestSpend =
    campaigns[0];

  const highestCpc =
    campaigns
      .filter(
        campaign =>
          campaign.clicks
          >= 5
      )
      .slice()
      .sort(
        (
          a,
          b
        ) =>
          b.avg_cpc
          -
          a.avg_cpc
      )[0];

  const bestCtr =
    campaigns
      .filter(
        campaign =>
          campaign.clicks
          >= 10
      )
      .slice()
      .sort(
        (
          a,
          b
        ) =>
          b.ctr
          -
          a.ctr
      )[0];

  const cards =
    [];

  if (
    highestSpend
  ) {

    const share =
      s.spend
      > 0

        ? highestSpend.spend
          /
          s.spend
          *
          100

        : 0;

    cards.push(`

      <article
        class="alert-card warning"
      >

        <div
          class="severity"
        >
          ОСНОВНОЙ РАСХОД
        </div>

        <h4>
          ${
            escapeHtml(
              highestSpend.name
            )
          }
        </h4>

        <p>
          ${
            money(
              highestSpend.spend
            )
          }
          —
          ${
            share.toFixed(
              1
            )
          }%
          расходов
          за выбранный период.
        </p>

      </article>

    `);
  }

  if (
    highestCpc
  ) {

    const relative =
      s.avg_cpc
      > 0

        ? highestCpc.avg_cpc
          /
          s.avg_cpc

        : 1;

    cards.push(`

      <article
        class="
          alert-card
          ${
            relative
            >= 1.5

              ? "critical"

              : "warning"
          }
        "
      >

        <div
          class="severity"
        >
          ВЫСОКИЙ CPC
        </div>

        <h4>
          ${
            escapeHtml(
              highestCpc.name
            )
          }
        </h4>

        <p>
          CPC
          ${
            money(
              highestCpc.avg_cpc
            )
          }.
          Среднее по аккаунту —
          ${
            s.avg_cpc
            > 0

              ? money(
                  s.avg_cpc
                )

              : "—"
          }.
        </p>

      </article>

    `);
  }

  if (
    bestCtr
  ) {

    cards.push(`

      <article
        class="alert-card opportunity"
      >

        <div
          class="severity"
        >
          ЛУЧШИЙ CTR
        </div>

        <h4>
          ${
            escapeHtml(
              bestCtr.name
            )
          }
        </h4>

        <p>
          CTR
          ${
            pct(
              bestCtr.ctr
            )
          }
          при
          ${
            number(
              bestCtr.clicks
            )
          }
          кликах.
        </p>

      </article>

    `);
  }

  container.innerHTML =
    cards.join("");
}

/* =========================================================
   ALERTS
========================================================= */

function medianFromSorted(
  values
) {

  if (
    !values.length
  ) {
    return 0;
  }

  const middle =
    Math.floor(
      values.length
      / 2
    );

  return (
    values.length
    % 2
  )
    ? values[
        middle
      ]

    : (
        values[
          middle - 1
        ]
        +
        values[
          middle
        ]
      )
      /
      2;
}

function buildAlerts(
  snapshot
) {

  const campaigns =
    snapshot.campaigns;

  const summary =
    snapshot.summary;

  const alerts =
    [];

  if (
    !campaigns.length
  ) {
    return alerts;
  }

  const spendValues =
    campaigns
      .map(
        campaign =>
          campaign.spend
      )
      .filter(
        value =>
          value > 0
      )
      .sort(
        (
          a,
          b
        ) =>
          a - b
      );

  const medianSpend =
    medianFromSorted(
      spendValues
    );

  campaigns.forEach(
    campaign => {

      if (
        campaign.conversions
        <= 0
        &&
        campaign.clicks
        >= 20
        &&
        campaign.spend
        >= medianSpend
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
              campaign.name
            }: ${
              money(
                campaign.spend
              )
            } расходов, ${
              number(
                campaign.clicks
              )
            } кликов и 0 конверсий.`,

          meta:
            `CTR ${
              pct(
                campaign.ctr
              )
            }`,
        });
      }

      if (
        summary.avg_cpc
        > 0
        &&
        campaign.avg_cpc
        >
        summary.avg_cpc
        *
        1.4
        &&
        campaign.clicks
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
              campaign.name
            }: CPC ${
              money(
                campaign.avg_cpc
              )
            } против ${
              money(
                summary.avg_cpc
              )
            } в среднем.`,

          meta:
            `${
              number(
                campaign.clicks
              )
            } кликов`,
        });
      }

      if (
        summary.ctr
        > 0
        &&
        campaign.ctr
        <
        summary.ctr
        *
        0.6
        &&
        campaign.impressions
        >= 1000
      ) {

        alerts.push({

          severity:
            "warning",

          label:
            "Внимание",

          title:
            "CTR заметно ниже среднего",

          text:
            `${
              campaign.name
            }: CTR ${
              pct(
                campaign.ctr
              )
            } при среднем ${
              pct(
                summary.ctr
              )
            }.`,

          meta:
            `${
              number(
                campaign.impressions
              )
            } показов`,
        });
      }
    }
  );

  const bestCtr =
    campaigns
      .filter(
        campaign =>
          campaign.clicks
          >= 10
      )
      .slice()
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

    alerts.push({

      severity:
        "opportunity",

      label:
        "Возможность",

      title:
        "Кампания с лучшим CTR",

      text:
        `${
          bestCtr.name
        }: CTR ${
          pct(
            bestCtr.ctr
          )
        }. Стоит проверить, можно ли масштабировать удачные настройки.`,

      meta:
        `${
          money(
            bestCtr.spend
          )
        } расходов`,
    });
  }

  return alerts;
}

function renderAlerts() {

  const container =
    document.getElementById(
      "allAlerts"
    );

  if (
    !container
  ) {
    return;
  }

  const alerts =
    buildAlerts(
      getOverviewSnapshot()
    );

  const filtered =
    ALERT_FILTER
    === "all"

      ? alerts

      : alerts.filter(
          alert =>
            alert.severity
            === ALERT_FILTER
        );

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
      button => {

        button.classList.toggle(
          "active",
          button.dataset.filter
          === ALERT_FILTER
        );
      }
    );

  if (
    !filtered.length
  ) {

    container.innerHTML =
      `
      <div
        class="note"
      >
        По выбранному фильтру
        сигналов нет.
      </div>
      `;

    return;
  }

  container.innerHTML =
    filtered
      .map(
        alert => `

          <article
            class="
              alert-row
              ${
                alert.severity
              }
            "
          >

            <div
              class="severity"
            >
              ${
                escapeHtml(
                  alert.label
                )
              }
            </div>

            <div>

              <h4>
                ${
                  escapeHtml(
                    alert.title
                  )
                }
              </h4>

              <p>
                ${
                  escapeHtml(
                    alert.text
                  )
                }
              </p>

            </div>

            <div
              class="meta"
            >
              ${
                escapeHtml(
                  alert.meta
                )
              }
            </div>

          </article>

        `
      )
      .join("");
}

/* =========================================================
   BUDGET
========================================================= */

function budgetRecommendation(
  campaign,
  summary
) {

  if (
    campaign.conversions
    <= 0
    &&
    campaign.clicks
    >= 20
  ) {

    return (
      "Проверить: расход без конверсий"
    );
  }

  if (
    campaign.cpa
    > 0
    &&
    summary.cpa
    > 0
    &&
    campaign.cpa
    <
    summary.cpa
    *
    0.8
  ) {

    return (
      "Потенциал для масштабирования"
    );
  }

  if (
    summary.avg_cpc
    > 0
    &&
    campaign.avg_cpc
    >
    summary.avg_cpc
    *
    1.3
  ) {

    return (
      "Проверить высокий CPC"
    );
  }

  if (
    summary.ctr
    > 0
    &&
    campaign.ctr
    >
    summary.ctr
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

function renderBudgetTable() {

  const container =
    document.getElementById(
      "budgetTable"
    );

  if (
    !container
  ) {
    return;
  }

  const snapshot =
    getOverviewSnapshot();

  const campaigns =
    snapshot.campaigns;

  const summary =
    snapshot.summary;

  if (
    !campaigns.length
  ) {

    container.innerHTML =
      `
      <div
        class="note"
      >
        Нет данных
        для анализа бюджета.
      </div>
      `;

    return;
  }

  container.innerHTML = `

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
              CTR
            </th>

            <th>
              CPC
            </th>

            <th>
              Конверсии
            </th>

            <th>
              CPA
            </th>

            <th>
              Сигнал
            </th>

          </tr>

        </thead>

        <tbody>

          ${
            campaigns
              .map(
                campaign => {

                  const share =
                    summary.spend
                    > 0

                      ? campaign.spend
                        /
                        summary.spend
                        *
                        100

                      : 0;

                  return `

                    <tr>

                      <td>
                        ${
                          escapeHtml(
                            campaign.name
                          )
                        }
                      </td>

                      <td>
                        ${
                          money(
                            campaign.spend
                          )
                        }
                      </td>

                      <td>
                        ${
                          share.toFixed(
                            1
                          )
                        }%
                      </td>

                      <td>
                        ${
                          pct(
                            campaign.ctr
                          )
                        }
                      </td>

                      <td>
                        ${
                          campaign.avg_cpc
                          > 0

                            ? money(
                                campaign.avg_cpc
                              )

                            : "—"
                        }
                      </td>

                      <td>
                        ${
                          metricNumber(
                            campaign.conversions
                          )
                        }
                      </td>

                      <td>
                        ${
                          campaign.cpa
                          > 0

                            ? money(
                                campaign.cpa
                              )

                            : "—"
                        }
                      </td>

                      <td>
                        ${
                          escapeHtml(
                            budgetRecommendation(
                              campaign,
                              summary
                            )
                          )
                        }
                      </td>

                    </tr>

                  `;
                }
              )
              .join("")
          }

        </tbody>

      </table>

    </div>

  `;
}

/* =========================================================
   CREATIVES
========================================================= */

function creativeStatus(
  status
) {

  const map = {

    successful: {
      icon:
        "🟢",
      label:
        "Успешный",
    },

    normal: {
      icon:
        "🟡",
      label:
        "Средний",
    },

    weak: {
      icon:
        "🔴",
      label:
        "Слабый",
    },

    fatigue: {
      icon:
        "🔥",
      label:
        "Выгорает",
    },

    improving: {
      icon:
        "🚀",
      label:
        "Улучшается",
    },

    insufficient_data: {
      icon:
        "⚪",
      label:
        "Мало данных",
    },

    no_peers: {
      icon:
        "⚪",
      label:
        "Не с чем сравнить",
    },

    unattributable: {
      icon:
        "⚫",
      label:
        "Нельзя определить",
    },
  };

  return (
    map[
      status
    ]
    ||
    map.normal
  );
}

function renderCreatives() {

  const container =
    document.getElementById(
      "creativeGrid"
    );

  if (
    !container
  ) {
    return;
  }

  const heading =
    document.querySelector(
      "#creatives h2"
    );

  const subtitle =
    document.querySelector(
      "#creatives .section-head p"
    );

  if (
    heading
  ) {

    heading.textContent =
      "Creative Intelligence";
  }

  if (
    subtitle
  ) {

    subtitle.textContent =
      "Какие именно картинки и видео работают лучше.";
  }

  const creatives =
    DATA.creatives
    || [];

  if (
    !creatives.length
  ) {

    container.innerHTML =
      `
      <div
        class="note"
      >
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
    creative.score
    === null
    ||
    creative.score
    === undefined

      ? "—"

      : creative.score;

  const trend =
    creative.trend
    || {};

  const preview =
    creative.preview_url
    ||
    creative.thumbnail_url
    ||
    creative.original_url
    ||
    null;

  const ads =
    creative.ad_ids
    || [];

  const attribution =
    creative.attribution
    || "";

  let attributionNote =
    "";

  if (
    creative.status
    === "unattributable"
  ) {

    attributionNote = `

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
        В объявлении несколько визуалов.
        Яндекс отдаёт общую статистику объявления,
        поэтому надёжно распределить результат нельзя.
      </div>

    `;

  } else if (
    attribution
    === "proxy"
  ) {

    attributionNote = `

      <div
        style="
          margin-top:12px;
          padding:10px;
          border-radius:8px;
          background:#0a1726;
          font-size:10px;
          line-height:1.5;
          color:#8ea2bb;
        "
      >
        Оценка proxy:
        статистика объявления
        с единственным визуальным ассетом.
      </div>

    `;
  }

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
                src="${
                  escapeAttribute(
                    preview
                  )
                }"
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
            ${
              escapeHtml(

                creative.kind
                === "image"

                  ? "IMAGE"

                  : creative.kind
                    === "video"

                    ? "VIDEO"

                    : "CREATIVE"
              )
            }
          </div>


          <h4>
            ${
              escapeHtml(

                creative.name

                ||

                (
                  creative.kind
                  === "image"

                    ? `Image ${
                        shorten(
                          creative.asset_id
                        )
                      }`

                    : `Creative ${
                        creative.asset_id
                        || ""
                      }`
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
        ${
          escapeHtml(
            creative.campaign_name
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
            `${
              state.icon
            } ${
              state.label
            }`
          )
        }

        ${
          pill(
            creative.network
            || "—"
          )
        }

        ${
          pill(
            creative.asset_type
            ||
            creative.kind
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
          miniStat(
            "CTR",
            pct(
              creative.ctr
            )
          )
        }

        ${
          miniStat(
            "CPC",

            creative.avg_cpc
            > 0

              ? money(
                  creative.avg_cpc
                )

              : "—"
          )
        }

        ${
          miniStat(
            "Клики",
            number(
              creative.clicks
            )
          )
        }

        ${
          miniStat(
            "Расход",
            money(
              creative.spend
            )
          )
        }

      </div>


      ${
        creative.baseline_ctr
        !== undefined
        &&
        creative.baseline_ctr
        !== null

          ? `

            <div
              style="
                margin-top:14px;
                padding-top:12px;
                border-top:1px solid #20354e;
                font-size:10px;
              "
            >

              ${
                comparisonRow(
                  "CTR",
                  creative.ctr,
                  creative.baseline_ctr,
                  "%"
                )
              }

              ${
                comparisonRow(
                  "CPC",
                  creative.avg_cpc,
                  creative.baseline_cpc,
                  "₽"
                )
              }

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

        ${
          trendRow(
            "CTR 7 дней",
            trend.ctr_change,
            false
          )
        }

        ${
          trendRow(
            "CPC 7 дней",
            trend.cpc_change,
            true
          )
        }

      </div>


      <p>
        ${
          escapeHtml(
            creative.reason
            || ""
          )
        }
      </p>


      <div
        style="
          margin-top:10px;
          font-size:9px;
          color:#667d95;
        "
      >
        Используется в
        ${
          ads.length
        }
        объявлениях
      </div>


      ${
        attributionNote
      }

    </article>

  `;
}

function miniStat(
  label,
  value
) {

  return `

    <div
      class="mini"
    >

      <span>
        ${
          escapeHtml(
            label
          )
        }
      </span>

      <strong>
        ${
          escapeHtml(
            value
          )
        }
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
      ${
        escapeHtml(
          text
        )
      }
    </span>

  `;
}

function trendRow(
  title,
  value,
  inverse
) {

  const numeric =
    Number(
      value
      || 0
    );

  const good =
    inverse

      ? numeric
        < 0

      : numeric
        > 0;

  const bad =
    inverse

      ? numeric
        > 0

      : numeric
        < 0;

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
        ${
          escapeHtml(
            title
          )
        }
      </span>

      <strong
        style="
          color:${color};
        "
      >
        ${
          numeric
          > 0

            ? "+"

            : ""
        }${
          numeric.toFixed(
            1
          )
        }%
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

  const numeric =
    Number(
      value
      || 0
    );

  const base =
    Number(
      baseline
      || 0
    );

  return `

    <div
      style="
        display:flex;
        justify-content:space-between;
        gap:10px;
        margin-top:6px;
      "
    >

      <span
        style="
          color:#8ea2bb;
        "
      >
        ${
          escapeHtml(
            label
          )
        }
        vs медиана
      </span>

      <strong>
        ${
          numeric.toFixed(
            2
          )
        }${suffix}
        /
        ${
          base.toFixed(
            2
          )
        }${suffix}
      </strong>

    </div>

  `;
}

function shorten(
  value
) {

  const text =
    String(
      value
      || ""
    );

  return (
    text.length
    <= 12
  )
    ? text

    : `${
        text.slice(
          0,
          6
        )
      }…${
        text.slice(
          -5
        )
      }`;
}

/* =========================================================
   KEYWORDS
========================================================= */

function keywordStatus(
  status
) {

  const map = {

    winner: {
      icon:
        "🟢",
      label:
        "Лидер",
    },

    efficient: {
      icon:
        "🟢",
      label:
        "Эффективная",
    },

    converting: {
      icon:
        "🟡",
      label:
        "Есть конверсии",
    },

    no_conversions: {
      icon:
        "🔴",
      label:
        "Нет конверсий",
    },

    needs_data: {
      icon:
        "⚪",
      label:
        "Мало данных",
    },

    weak: {
      icon:
        "🔴",
      label:
        "Слабая",
    },
  };

  return (
    map[
      status
    ]
    ||
    {
      icon:
        "⚪",
      label:
        "Без оценки",
    }
  );
}

function getKeywordSummary(
  keywords
) {

  const backend =
    DATA.keyword_summary
    || {};

  const totalConversions =
    keywords.reduce(
      (
        sum,
        item
      ) =>
        sum
        +
        Number(
          item.conversions
          || 0
        ),
      0
    );

  const totalCost =
    keywords.reduce(
      (
        sum,
        item
      ) =>
        sum
        +
        Number(
          item.cost
          ??
          item.spend
          ??
          0
        ),
      0
    );

  const totalClicks =
    keywords.reduce(
      (
        sum,
        item
      ) =>
        sum
        +
        Number(
          item.clicks
          || 0
        ),
      0
    );

  const top =
    keywords
      .filter(
        item =>
          Number(
            item.conversions
            || 0
          ) > 0
      )
      .slice()
      .sort(
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
      )[0];

  return {

    total_keywords:
      backend.total_keywords
      ??
      keywords.length,

    with_conversions:
      backend.with_conversions
      ??
      keywords.filter(
        item =>
          Number(
            item.conversions
            || 0
          ) > 0
      ).length,

    total_conversions:
      backend.total_conversions
      ??
      totalConversions,

    total_cost:
      backend.total_cost
      ??
      totalCost,

    avg_cpa:
      backend.avg_cpa
      ??
      (
        totalConversions
        > 0

          ? totalCost
            /
            totalConversions

          : 0
      ),

    conversion_rate:
      backend.conversion_rate
      ??
      (
        totalClicks
        > 0

          ? totalConversions
            /
            totalClicks
            *
            100

          : 0
      ),

    top_keyword:
      backend.top_keyword
      ??
      top?.keyword
      ??
      null,

    top_keyword_conversions:
      backend.top_keyword_conversions
      ??
      top?.conversions
      ??
      0,
  };
}

function renderKeywords() {

  const tableContainer =
    document.getElementById(
      "keywordsTable"
    );

  const kpiContainer =
    document.getElementById(
      "keywordKpis"
    );

  const noteContainer =
    document.getElementById(
      "keywordNote"
    );

  if (
    !tableContainer
  ) {
    return;
  }

  const keywords =
    [
      ...(
        DATA.keywords
        || []
      )
    ];

  const summary =
    getKeywordSummary(
      keywords
    );

  if (
    kpiContainer
  ) {

    const items = [

      [
        "Ключевых фраз",
        number(
          summary.total_keywords
        ),
      ],

      [
        "С конверсиями",
        number(
          summary.with_conversions
        ),
      ],

      [
        "Конверсии",
        metricNumber(
          summary.total_conversions
        ),
      ],

      [
        "Средний CPA",

        Number(
          summary.avg_cpa
          || 0
        ) > 0

          ? money(
              summary.avg_cpa
            )

          : "—",
      ],
    ];

    kpiContainer.innerHTML =
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
                ${
                  escapeHtml(
                    label
                  )
                }
              </div>

              <div
                class="value"
              >
                ${
                  escapeHtml(
                    value
                  )
                }
              </div>

              <div
                class="delta neutral"
              >
                за ${
                  Number(
                    DATA.meta
                      ?.period_days
                    ||
                    60
                  )
                } дней
              </div>

            </div>

          `
        )
        .join("");
  }

  if (
    noteContainer
  ) {

    noteContainer.innerHTML =
      summary.top_keyword

        ? `

          <strong>
            Лидер по конверсиям:
          </strong>

          ${
            escapeHtml(
              summary.top_keyword
            )
          }
          —
          ${
            metricNumber(
              summary.top_keyword_conversions
            )
          }
          конверсий.

          Средний CPA
          по ключевым фразам —
          ${
            summary.avg_cpa
            > 0

              ? money(
                  summary.avg_cpa
                )

              : "—"
          }.

        `

        : `

          В отчёте пока нет
          ключевых фраз
          с зарегистрированными
          конверсиями.

        `;
  }

  if (
    !keywords.length
  ) {

    tableContainer.innerHTML =
      `
      <div
        class="note"
      >
        Ключевые фразы
        не найдены
        или по ним пока
        нет статистики.
      </div>
      `;

    return;
  }

  keywords.sort(
    (
      a,
      b
    ) => {

      const diff =
        Number(
          b.conversions
          || 0
        )
        -
        Number(
          a.conversions
          || 0
        );

      if (
        diff !== 0
      ) {
        return diff;
      }

      const aCpa =
        Number(
          a.cpa
          || 0
        );

      const bCpa =
        Number(
          b.cpa
          || 0
        );

      if (
        aCpa > 0
        &&
        bCpa > 0
      ) {

        return (
          aCpa
          -
          bCpa
        );
      }

      return (
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
    }
  );

  tableContainer.innerHTML = `

    <table
      class="table"
    >

      <thead>

        <tr>

          <th>
            #
          </th>

          <th>
            Ключевая фраза
          </th>

          <th>
            Конверсии
          </th>

          <th>
            Доля
          </th>

          <th>
            CPA
          </th>

          <th>
            CR
          </th>

          <th>
            Клики
          </th>

          <th>
            CTR
          </th>

          <th>
            Расход
          </th>

          <th>
            Кампании
          </th>

          <th>
            Статус
          </th>

        </tr>

      </thead>

      <tbody>

        ${
          keywords
            .map(
              (
                keyword,
                index
              ) => {

                const state =
                  keywordStatus(
                    keyword.status
                  );

                const conversions =
                  Number(
                    keyword.conversions
                    || 0
                  );

                const totalConversions =
                  Number(
                    summary.total_conversions
                    || 0
                  );

                const share =
                  keyword.conversion_share
                  !== undefined

                    ? Number(
                        keyword.conversion_share
                        || 0
                      )

                    : (
                        totalConversions
                        > 0

                          ? conversions
                            /
                            totalConversions
                            *
                            100

                          : 0
                      );

                const cr =
                  keyword.conversion_rate
                  !== undefined

                    ? Number(
                        keyword.conversion_rate
                        || 0
                      )

                    : (
                        Number(
                          keyword.clicks
                          || 0
                        ) > 0

                          ? conversions
                            /
                            Number(
                              keyword.clicks
                            )
                            *
                            100

                          : 0
                      );

                const campaignNames =
                  Array.isArray(
                    keyword.campaign_names
                  )

                    ? keyword.campaign_names

                    : (
                        keyword.campaign_name

                          ? [
                              keyword.campaign_name
                            ]

                          : []
                      );

                return `

                  <tr>

                    <td>
                      ${
                        keyword.rank
                        ||
                        index + 1
                      }
                    </td>

                    <td>

                      <strong>
                        ${
                          escapeHtml(
                            keyword.keyword
                            || "—"
                          )
                        }
                      </strong>

                    </td>

                    <td>
                      ${
                        metricNumber(
                          conversions
                        )
                      }
                    </td>

                    <td>
                      ${
                        share.toFixed(
                          2
                        )
                      }%
                    </td>

                    <td>
                      ${
                        Number(
                          keyword.cpa
                          || 0
                        ) > 0

                          ? money(
                              keyword.cpa
                            )

                          : "—"
                      }
                    </td>

                    <td>
                      ${
                        pct(
                          cr
                        )
                      }
                    </td>

                    <td>
                      ${
                        number(
                          keyword.clicks
                        )
                      }
                    </td>

                    <td>
                      ${
                        pct(
                          keyword.ctr
                        )
                      }
                    </td>

                    <td>
                      ${
                        money(
                          keyword.cost
                          ??
                          keyword.spend
                          ??
                          0
                        )
                      }
                    </td>

                    <td>
                      ${
                        escapeHtml(

                          campaignNames.length

                            ? campaignNames.join(
                                ", "
                              )

                            : "—"
                        )
                      }
                    </td>

                    <td>
                      ${
                        escapeHtml(
                          `${
                            state.icon
                          } ${
                            state.label
                          }`
                        )
                      }
                    </td>

                  </tr>

                `;
              }
            )
            .join("")
        }

      </tbody>

    </table>

  `;
}

/* =========================================================
   NAVIGATION / EVENTS
========================================================= */

document.addEventListener(
  "click",
  event => {

    const navButton =
      event.target.closest(
        ".nav[data-section]"
      );

    if (
      navButton
    ) {

      showSection(
        navButton.dataset.section
      );

      return;
    }

    const gotoButton =
      event.target.closest(
        "[data-goto]"
      );

    if (
      gotoButton
    ) {

      showSection(
        gotoButton.dataset.goto
      );

      return;
    }

    const filterButton =
      event.target.closest(
        "#alertFilters [data-filter]"
      );

    if (
      filterButton
    ) {

      ALERT_FILTER =
        filterButton.dataset.filter
        || "all";

      renderAlerts();
    }
  }
);

const refreshButton =
  document.getElementById(
    "refreshBtn"
  );

if (
  refreshButton
) {

  refreshButton.addEventListener(
    "click",
    async () => {

      const password =
        sessionStorage.getItem(
          "marketingRadarPassword"
        );

      if (
        !password
      ) {
        return;
      }

      refreshButton.disabled =
        true;

      const oldText =
        refreshButton.textContent;

      refreshButton.textContent =
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

        refreshButton.disabled =
          false;

        refreshButton.textContent =
          oldText;
      }
    }
  );
}

const periodSelect =
  document.getElementById(
    "periodSelect"
  );

if (
  periodSelect
) {

  periodSelect.addEventListener(
    "change",
    () => {

      if (
        !DATA
      ) {
        return;
      }

      renderOverview();

      renderAlerts();

      renderBudgetTable();
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
    document.getElementById(
      id
    );

  if (
    target
  ) {

    target.classList.add(
      "active"
    );
  }

  const titles = {

    overview: [

      "Обзор рекламы",

      "Актуальные показатели Яндекс Директа без блока креативов.",
    ],

    alerts: [

      "Аномалии",

      "Автоматический контроль отклонений по рекламным показателям.",
    ],

    budget: [

      "Budget Optimizer",

      "Анализ расходов, трафика, конверсий и стоимости результата.",
    ],

    creatives: [

      "Creative Intelligence",

      "Какие именно визуалы работают лучше остальных.",
    ],

    keywords: [

      "Ключевые фразы",

      "Какие рекламные ключи чаще всего приводят к конверсиям.",
    ],
  };

  if (
    titles[
      id
    ]
  ) {

    const title =
      document.getElementById(
        "pageTitle"
      );

    const subtitle =
      document.getElementById(
        "pageSubtitle"
      );

    if (
      title
    ) {

      title.textContent =
        titles[
          id
        ][0];
    }

    if (
      subtitle
    ) {

      subtitle.textContent =
        titles[
          id
        ][1];
    }
  }
}

/* =========================================================
   UTILITIES
========================================================= */

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

function escapeHtml(
  value
) {

  return String(
    value
    ?? ""
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
