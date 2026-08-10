let DATA = null;
let currentAlertFilter = "all";

const fmt = new Intl.NumberFormat("ru-RU");
const money = v => `${fmt.format(Math.round(v))} ₽`;
const pct = v => `${Number(v).toFixed(1)}%`;

async function loadData() {
  const res = await fetch(`data/report.json?t=${Date.now()}`);
  DATA = await res.json();
  render();
}

function deltaClass(value, inverse=false){
  if (value === 0) return "neutral";
  const good = inverse ? value < 0 : value > 0;
  return good ? "positive" : "negative";
}
function sign(v){ return v > 0 ? "+" : ""; }

function render(){
  const meta = DATA.meta;
  document.getElementById("sidebarUpdated").textContent = meta.updated_at;
  document.getElementById("footerUpdated").textContent = `Обновлено ${meta.updated_at}`;
  document.getElementById("navAlertCount").textContent = DATA.alerts.length;

  const critical = DATA.alerts.filter(x => x.severity === "critical").length;
  document.getElementById("heroHeadline").textContent = critical
    ? `Обнаружено ${critical} критических события`
    : "Критических проблем не обнаружено";
  document.getElementById("heroCopy").textContent = `Всего сигналов: ${DATA.alerts.length}. Данные за ${meta.period_days} дней.`;
  document.getElementById("healthScore").textContent = DATA.summary.health_score;

  const kpis = [
    ["Расход", money(DATA.summary.spend), DATA.summary.spend_change, true],
    ["Конверсии", fmt.format(DATA.summary.conversions), DATA.summary.conversions_change, false],
    ["CPA", money(DATA.summary.cpa), DATA.summary.cpa_change, true],
    ["CTR", pct(DATA.summary.ctr), DATA.summary.ctr_change, false]
  ];
  document.getElementById("kpis").innerHTML = kpis.map(([label,value,delta,inverse]) => `
    <div class="kpi">
      <div class="label">${label}</div>
      <div class="value">${value}</div>
      <div class="delta ${deltaClass(delta,inverse)}">${sign(delta)}${delta.toFixed(1)}% к прошлому периоду</div>
    </div>`).join("");

  document.getElementById("priorityAlerts").innerHTML = DATA.alerts.slice(0,3).map(alertCard).join("");
  renderCampaignTable();
  renderBudget();
  renderAlerts();
  renderCreatives();
}

function alertCard(a){
  const label = a.severity === "critical" ? "Критично" : a.severity === "warning" ? "Внимание" : "Возможность";
  return `<article class="alert-card ${a.severity}">
    <div class="alert-top"><span class="severity">${label}</span><span class="impact">${a.impact}</span></div>
    <h4>${a.title}</h4>
    <p>${a.description}</p>
  </article>`;
}

function renderCampaignTable(){
  document.getElementById("campaignTable").innerHTML = `
  <table class="table">
    <thead><tr><th>Кампания</th><th>Расход</th><th>CPA</th><th>CR</th><th>Score</th></tr></thead>
    <tbody>${DATA.campaigns.map(c => {
      const cls = c.score >= 75 ? "good" : c.score >= 50 ? "mid" : "bad";
      return `<tr><td>${c.name}</td><td>${money(c.spend)}</td><td>${money(c.cpa)}</td><td>${pct(c.cr)}</td><td class="score ${cls}">${c.score}</td></tr>`;
    }).join("")}</tbody>
  </table>`;
}

function renderBudget(){
  const rows = DATA.budget_recommendations;
  document.getElementById("budgetPreview").innerHTML = rows.slice(0,4).map(budgetItem).join("");
  document.getElementById("budgetTable").innerHTML = `
  <table class="table">
    <thead><tr><th>Кампания</th><th>Текущий бюджет</th><th>Рекомендация</th><th>Изменение</th><th>Причина</th></tr></thead>
    <tbody>${rows.map(b => {
      const cls = b.change > 0 ? "up" : b.change < 0 ? "down" : "same";
      return `<tr><td>${b.name}</td><td>${money(b.current)}</td><td>${money(b.recommended)}</td><td class="budget-change ${cls}">${sign(b.change)}${money(b.change)}</td><td>${b.reason}</td></tr>`;
    }).join("")}</tbody>
  </table>`;
}

function budgetItem(b){
  const cls = b.change > 0 ? "up" : b.change < 0 ? "down" : "same";
  return `<div class="budget-item"><div><strong>${b.name}</strong><small>${b.reason}</small></div><strong class="budget-change ${cls}">${sign(b.change)}${money(b.change)}</strong></div>`;
}

function renderAlerts(){
  const rows = DATA.alerts.filter(a => currentAlertFilter === "all" || a.severity === currentAlertFilter);
  document.getElementById("allAlerts").innerHTML = rows.map(a => {
    const label = a.severity === "critical" ? "Критично" : a.severity === "warning" ? "Внимание" : "Возможность";
    return `<article class="alert-row ${a.severity}">
      <div class="severity">${label}</div>
      <div><h4>${a.title}</h4><p>${a.description}</p></div>
      <div class="meta">${a.impact}<br>${a.entity}</div>
    </article>`;
  }).join("");
}

function renderCreatives(){
  document.getElementById("creativeGrid").innerHTML = DATA.creatives.map(c => {
    const state = c.fatigue_score >= 65 ? "Заменить" : c.fatigue_score >= 40 ? "Наблюдать" : "Норма";
    return `<article class="creative">
      <div class="creative-head"><h4>${c.name}</h4><span class="fatigue">${c.fatigue_score}</span></div>
      <div class="meter"><span style="width:${c.fatigue_score}%"></span></div>
      <div class="stats">
        <div class="mini"><span>CTR динамика</span><strong class="${deltaClass(c.ctr_change)}">${sign(c.ctr_change)}${c.ctr_change}%</strong></div>
        <div class="mini"><span>CPA динамика</span><strong class="${deltaClass(c.cpa_change,true)}">${sign(c.cpa_change)}${c.cpa_change}%</strong></div>
      </div>
      <p><strong>${state}.</strong> ${c.recommendation}</p>
    </article>`;
  }).join("");
}

document.querySelectorAll(".nav").forEach(btn => btn.addEventListener("click", () => showSection(btn.dataset.section)));
document.querySelectorAll("[data-goto]").forEach(btn => btn.addEventListener("click", () => showSection(btn.dataset.goto)));
document.querySelectorAll("#alertFilters button").forEach(btn => btn.addEventListener("click", () => {
  document.querySelectorAll("#alertFilters button").forEach(x => x.classList.remove("active"));
  btn.classList.add("active"); currentAlertFilter = btn.dataset.filter; renderAlerts();
}));
document.getElementById("refreshBtn").addEventListener("click", loadData);

function showSection(id){
  document.querySelectorAll(".section").forEach(x => x.classList.remove("active"));
  document.querySelectorAll(".nav").forEach(x => x.classList.toggle("active", x.dataset.section === id));
  document.getElementById(id).classList.add("active");
  const titles = {overview:["Обзор рекламы","Что требует внимания и где есть потенциал роста."],alerts:["Аномалии","Автоматические сигналы по рекламным данным."],budget:["Budget Optimizer","Рекомендации по перераспределению бюджета."],creatives:["Creative Fatigue","Контроль выгорания рекламных материалов."]};
  document.getElementById("pageTitle").textContent=titles[id][0];
  document.getElementById("pageSubtitle").textContent=titles[id][1];
}

loadData().catch(err => {
  console.error(err);
  document.getElementById("heroHeadline").textContent = "Не удалось загрузить report.json";
  document.getElementById("heroCopy").textContent = "Проверьте наличие файла data/report.json.";
});
