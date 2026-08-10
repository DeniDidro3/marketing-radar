let DATA = null;

const fmt = new Intl.NumberFormat("ru-RU");

const money = (v) =>
  `${fmt.format(Math.round(Number(v || 0)))} ₽`;

const number = (v) =>
  fmt.format(Math.round(Number(v || 0)));

const pct = (v) =>
  `${Number(v || 0).toFixed(2)}%`;


function base64ToBytes(base64) {
  const binary = atob(base64);

  const bytes =
    new Uint8Array(binary.length);

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
      salt: salt,
      iterations: iterations,
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
    base64ToBytes(payload.salt);

  const nonce =
    base64ToBytes(payload.nonce);

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

  const decoder =
    new TextDecoder();

  return JSON.parse(
    decoder.decode(plaintext)
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


function showLogin() {
  document.body.insertAdjacentHTML(
    "beforeend",
    `
    <div id="loginOverlay"
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
          margin:0 0 22px;
          color:#8ea2bb;
          font-size:13px;
          line-height:1.5;
        ">
          Введите пароль для расшифровки
          рекламных данных.
        </p>

        <input
          id="reportPassword"
          type="password"
          placeholder="Пароль"
          autocomplete="current-password"
          style="
            width:100%;
            padding:13px 14px;
            border-radius:9px;
            border:1px solid #20354e;
            background:#091525;
            color:white;
            outline:none;
            margin-bottom:10px;
          "
        />

        <div
          id="loginError"
          style="
            min-height:18px;
            color:#ff6b72;
            font-size:11px;
            margin-bottom:10px;
          "
        ></div>

        <button
          id="loginButton"
          style="
            width:100%;
            padding:13px 14px;
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

  const login =
    async () => {
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
            "Неверный пароль или повреждены данные.";

        button.disabled = false;
        button.textContent =
          "Войти";
      }
    };

  button.addEventListener(
    "click",
    login
  );

  input.addEventListener(
    "keydown",
    (event) => {
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
  const savedPassword =
    sessionStorage.getItem(
      "marketingRadarPassword"
    );

  if (savedPassword) {
    try {
      DATA =
        await loadEncryptedReport(
          savedPassword
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


function render() {
  renderMeta();
  renderHero();
  renderKPIs();
  renderCampaignTable();
  renderDirectSummary();
  renderPlaceholderSections();
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

  const badge =
    document.getElementById(
      "navAlertCount"
    );

  if (badge) {
    badge.textContent = "—";
  }
}


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
    `${money(s.spend)} расходов за ` +
    `${DATA.meta?.period_days || 60} дней.`;

  document.getElementById(
    "healthScore"
  ).textContent =
    "LIVE";
}


function renderKPIs() {
  const s =
    DATA.summary || {};

  const items = [
    [
      "Расход",
      money(s.spend),
    ],
    [
      "Показы",
      number(s.impressions),
    ],
    [
      "Клики",
      number(s.clicks),
    ],
    [
      "CTR",
      pct(s.ctr),
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


function renderCampaignTable() {
  const campaigns =
    [...(DATA.campaigns || [])];

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
        ${campaigns.map(
          c => `
            <tr>
              <td>${escapeHtml(c.name)}</td>
              <td>${money(c.spend)}</td>
              <td>${number(c.impressions)}</td>
              <td>${number(c.clicks)}</td>
              <td>${pct(c.ctr)}</td>
              <td>${money(c.avg_cpc)}</td>
            </tr>
          `
        ).join("")}
      </tbody>
    </table>
  `;
}


function renderDirectSummary() {
  const campaigns =
    [...(DATA.campaigns || [])];

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

  document.getElementById(
    "budgetPreview"
  ).innerHTML = `
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
            ${pct(bestCtr.ctr)}
          </strong>
        </div>
        `
        : ""
    }
  `;
}


function renderPlaceholderSections() {
  const alerts =
    document.getElementById(
      "priorityAlerts"
    );

  if (alerts) {
    alerts.innerHTML = `
      <article class="alert-card opportunity">
        <div class="alert-top">
          <span class="severity">
            Система защищена
          </span>
        </div>

        <h4>
          Данные зашифрованы
        </h4>

        <p>
          Открытый report.json больше
          не используется.
        </p>
      </article>
    `;
  }
}


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
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


start();
