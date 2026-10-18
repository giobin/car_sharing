import { DAYS, STORAGE_KEY, emptyState, normalizeState, validateVisits, applyTemplate, planDay, monday, addDays } from './planner.js';

const $ = id => document.getElementById(id);
const uid = () => crypto.randomUUID();
function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
function button(text, onClick, className = 'text-button') { const element = node('button', text, className); element.type = 'button'; element.onclick = onClick; return element; }
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
let state = emptyState(), week = monday(today), activeTab = 'week', selectedDay = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
if (selectedDay === 6) { week = addDays(week, 7); selectedDay = 0; }
let templateDay = 0, undo = [], editing = null, confirmAction = null, lastPlan = null, persistenceBlocked = false;

function tell(message, error = false) { $('notice').textContent = message; $('notice').className = error ? 'warning' : 'notice'; $('notice').hidden = false; }
function storageWarning(message) { $('storageWarning').textContent = message; $('storageWarning').hidden = false; }
try {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) state = normalizeState(JSON.parse(raw));
} catch {
  persistenceBlocked = true;
  storageWarning('Non riesco a leggere i dati salvati. Non verranno sovrascritti. Puoi importare un backup valido; per ora le modifiche restano solo in questa pagina.');
}
function persist() {
  if (persistenceBlocked) { $('saveStatus').textContent = 'Modifiche non salvate: esporta un backup prima di chiudere.'; return; }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    $('saveStatus').textContent = 'Salvato in questo browser.'; $('storageWarning').hidden = true;
  } catch { storageWarning('Il browser non ha salvato le modifiche. Esporta un backup prima di chiudere la pagina.'); $('saveStatus').textContent = 'Modifiche non salvate.'; }
}
function commit(next, message) {
  const valid = normalizeState(next);
  undo.push(structuredClone(state)); if (undo.length > 20) undo.shift();
  state = valid; lastPlan = null; persist(); render(); if (message) tell(message);
}
function change(mutate, message) {
  const next = structuredClone(state);
  try { mutate(next); commit(next, message); } catch (error) { tell(error.message, true); }
}
function confirm(title, text, action, label = 'Conferma') {
  $('confirmTitle').textContent = title; $('confirmText').textContent = text; $('acceptConfirm').textContent = label;
  confirmAction = action; $('confirmDialog').showModal();
}
function formatDate(date) { return new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`)); }
const weekRows = () => state.weeks[week] || [];

function renderDays(scope, day, rows) {
  const container = $(`${scope}Days`); container.replaceChildren();
  DAYS.forEach((name, index) => {
    const count = new Set(rows.filter(v => v.day === index).map(v => v.personId)).size;
    const item = button(name, () => { if (scope === 'week') selectedDay = index; else templateDay = index; render(); }, '');
    item.setAttribute('aria-pressed', String(day === index));
    item.append(node('small', scope === 'week' ? `${formatDate(addDays(week, index))} · ${count} colleghi` : `${count} colleghi`)); container.append(item);
  });
}
function renderVisits(scope, day, rows) {
  $(`${scope}DayTitle`).textContent = scope === 'week' ? `${DAYS[day]} ${formatDate(addDays(week, day))}` : DAYS[day];
  const target = $(`${scope}Visits`); target.replaceChildren();
  const dayVisits = rows.filter(v => v.day === day);
  if (!dayVisits.length) { target.append(node('div', state.people.length ? 'Nessuna fascia per questo giorno. Aggiungi un ingresso e un’uscita per ogni collega che viaggia.' : 'Inizia da “Colleghi e auto”, oppure importa gli orari già preparati.', 'empty')); return; }
  for (const person of [...state.people].sort((a, b) => a.name.localeCompare(b.name, 'it'))) {
    const visits = dayVisits.filter(v => v.personId === person.id).sort((a, b) => a.start.localeCompare(b.start));
    if (!visits.length) continue;
    const row = node('div', undefined, 'schedule-row'); row.append(node('div', person.name, 'person-name'));
    const list = node('div', undefined, 'visit-list');
    visits.forEach((v, index) => {
      const item = node('div', undefined, 'visit'); item.append(node('span', `${v.start} – ${v.end}`, 'visit-time'));
      if (visits.length > 1) item.append(node('span', `${index + 1}ª andata e ritorno`, 'badge'));
      if (v.needsReview) item.append(node('span', 'Da verificare', 'badge review'));
      const actions = node('div', undefined, 'visit-actions');
      actions.append(button('Modifica', () => openVisit(scope, v)), button('Rimuovi', () => change(next => {
        if (scope === 'template') next.template = next.template.filter(x => x.id !== v.id);
        else next.weeks[week] = (next.weeks[week] || []).filter(x => x.id !== v.id);
      }, 'Fascia rimossa. Puoi annullare la modifica in fondo alla pagina.'), 'text-button danger'));
      item.append(actions); if (v.note) item.append(node('p', v.note, 'note')); list.append(item);
    });
    list.append(button('Aggiungi un’altra fascia', () => openVisit(scope, null, person.id))); row.append(list); target.append(row);
  }
}
function renderPeople() {
  $('peopleList').replaceChildren();
  for (const person of state.people) {
    const card = node('div', undefined, 'person-card'), heading = node('div', undefined, 'card-heading');
    heading.append(node('strong', person.name), button('Rimuovi', () => {
      const uses = [...state.template, ...Object.values(state.weeks).flat()].filter(v => v.personId === person.id).length;
      const remove = () => change(next => {
        next.people = next.people.filter(p => p.id !== person.id); next.template = next.template.filter(v => v.personId !== person.id);
        for (const key of Object.keys(next.weeks)) next.weeks[key] = next.weeks[key].filter(v => v.personId !== person.id);
      }, `${person.name} rimosso. Puoi annullare l’operazione.`);
      if (uses) confirm('Rimuovere il collega?', `Verranno rimosse anche le ${uses} fasce di ${person.name} nell’orario tipo e nelle settimane preparate. Puoi annullare l’operazione.`, remove, 'Rimuovi collega'); else remove();
    }, 'text-button danger'));
    const label = node('label', undefined, 'checkbox'), checkbox = node('input'); checkbox.type = 'checkbox'; checkbox.checked = person.hasCar;
    checkbox.setAttribute('aria-label', `Auto disponibile: ${person.name}`);
    checkbox.onchange = () => change(next => { next.people.find(p => p.id === person.id).hasCar = checkbox.checked; }, 'Disponibilità auto aggiornata. Ricalcola il piano.');
    label.append(checkbox, document.createTextNode('Auto disponibile')); card.append(heading, label); $('peopleList').append(card);
  }
  if (!state.people.length) $('peopleList').append(node('div', 'Aggiungi i colleghi del gruppo.', 'empty'));
  $('capacity').value = state.settings.capacity; $('travelMinutes').value = state.settings.travelMinutes;
}
function render() {
  for (const tab of ['week', 'template', 'people']) $(`${tab}Panel`).hidden = tab !== activeTab;
  document.querySelectorAll('[data-tab]').forEach(el => { if (el.dataset.tab === activeTab) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current'); });
  $('weekDate').value = week; $('undoButton').disabled = !undo.length;
  $('importNotes').replaceChildren(...state.importNotes.map(note => node('p', note)));
  $('importNotes').hidden = !state.importNotes.length;
  const prepared = Object.hasOwn(state.weeks, week);
  $('weekSummary').textContent = prepared ? `${weekRows().length} fasce in questa settimana. Puoi modificarle senza cambiare l’orario tipo.` : 'La settimana è ancora da preparare. Gli orari abituali si copiano con un clic.';
  $('applyButton').textContent = prepared ? 'Ripristina dall’orario tipo' : 'Precompila dall’orario tipo'; $('applyButton').disabled = !state.template.length;
  renderDays('week', selectedDay, weekRows()); renderDays('template', templateDay, state.template);
  renderVisits('week', selectedDay, weekRows()); renderVisits('template', templateDay, state.template); renderPeople();
  $('addWeekVisit').disabled = $('addTemplateVisit').disabled = !state.people.length;
  if (!lastPlan) $('planOutput').replaceChildren(node('div', 'Quando gli orari sono pronti, calcola i viaggi della settimana.', 'empty'));
}
function openVisit(scope, visit = null, personId = null) {
  editing = { scope, id: visit?.id, day: scope === 'week' ? selectedDay : templateDay };
  $('visitDialogTitle').textContent = visit ? 'Modifica fascia' : 'Aggiungi una fascia';
  $('visitContext').textContent = `${DAYS[editing.day]}${scope === 'week' ? ` ${formatDate(addDays(week, editing.day))} · Solo questa settimana` : ' · Orario tipo'}`;
  $('visitPerson').replaceChildren(...state.people.map(p => { const option = node('option', p.name); option.value = p.id; return option; }));
  $('visitPerson').value = visit?.personId || personId || state.people[0]?.id || '';
  $('visitStart').value = visit?.start || ''; $('visitEnd').value = visit?.end || ''; $('visitNote').value = visit?.note || '';
  $('visitReviewed').checked = false; $('reviewLabel').hidden = !visit?.needsReview; $('visitError').textContent = ''; $('visitDialog').showModal();
}
$('visitForm').onsubmit = event => {
  event.preventDefault();
  const next = structuredClone(state), rows = editing.scope === 'template' ? next.template : (next.weeks[week] ||= []), old = rows.find(v => v.id === editing.id);
  const visit = { id: editing.id || uid(), personId: $('visitPerson').value, day: editing.day, start: $('visitStart').value, end: $('visitEnd').value, note: $('visitNote').value.trim(), needsReview: Boolean(old?.needsReview && !$('visitReviewed').checked) };
  const proposed = [...rows.filter(v => v.id !== editing.id), visit];
  try {
    const issues = validateVisits(proposed.filter(v => v.personId === visit.personId && v.day === visit.day), next.people, next.settings.travelMinutes);
    if (issues.length) throw new Error(issues[0]);
    if (editing.scope === 'template') next.template = proposed; else next.weeks[week] = proposed;
    commit(next, 'Fascia salvata.'); $('visitDialog').close();
  } catch (error) { $('visitError').textContent = error.message; }
};
for (const id of ['closeVisit', 'cancelVisit']) $(id).onclick = () => $('visitDialog').close();
$('cancelConfirm').onclick = () => { confirmAction = null; $('confirmDialog').close(); };
$('acceptConfirm').onclick = () => { const action = confirmAction; confirmAction = null; $('confirmDialog').close(); try { action?.(); } catch (error) { tell(error.message, true); } };
document.querySelectorAll('[data-tab]').forEach(el => el.onclick = () => { activeTab = el.dataset.tab; render(); });
$('weekDate').onchange = () => { try { week = monday($('weekDate').value); lastPlan = null; render(); } catch (error) { tell(error.message, true); } };
$('addWeekVisit').onclick = () => openVisit('week'); $('addTemplateVisit').onclick = () => openVisit('template');
$('applyButton').onclick = () => {
  const apply = () => commit(applyTemplate(state, week, uid, true), 'Settimana precompilata. Controlla eventuali assenze e rientri intermedi.');
  if (Object.hasOwn(state.weeks, week)) confirm('Ripristinare gli orari della settimana?', 'Le modifiche di questa settimana saranno sostituite dall’orario tipo. Le altre settimane restano invariate. Puoi annullare l’operazione.', apply, 'Ripristina settimana'); else apply();
};
$('personForm').onsubmit = event => {
  event.preventDefault(); const name = $('personName').value.trim(); if (!name) return;
  const count = state.people.length; change(next => { next.people.push({ id: uid(), name, hasCar: $('personCar').checked }); }, `${name} aggiunto al gruppo.`);
  if (state.people.length > count) { $('personName').value = ''; $('personCar').checked = false; }
};
$('settingsForm').onsubmit = event => { event.preventDefault(); change(next => { next.settings = { capacity: Number($('capacity').value), travelMinutes: Number($('travelMinutes').value) }; }, 'Impostazioni salvate. Ricalcola il piano.'); };
$('undoButton').onclick = () => { if (!undo.length) return; state = undo.pop(); lastPlan = null; persist(); render(); tell('Ultima modifica annullata.'); };
function download(filename, contents, type) {
  const url = URL.createObjectURL(new Blob([contents], { type })), link = node('a'); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('exportButton').onclick = () => download('viaggi-a-scuola-backup.json', JSON.stringify(state, null, 2), 'application/json');
$('importButton').onclick = () => $('importFile').click();
$('importFile').onchange = async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    if (file.size > 2_000_000) throw new Error('Il file è troppo grande (massimo 2 MB).');
    const imported = normalizeState(JSON.parse(await file.text())), pending = imported.template.filter(v => v.needsReview).length;
    confirm('Importa gli orari', `${imported.people.length} colleghi, ${imported.template.length} fasce nell’orario tipo, ${Object.keys(imported.weeks).length} settimane.${pending ? ` ${pending === 1 ? 'Una fascia da verificare' : `${pending} fasce da verificare`} prima di calcolare i viaggi.` : ''} L’importazione sostituisce i dati attuali; puoi annullarla.`, () => {
      persistenceBlocked = false;
      commit(imported, 'Orari importati. Controlla le fasce da verificare e indica le auto disponibili in “Colleghi e auto”.');
      if (imported.template.length) {
        activeTab = 'template'; templateDay = Math.min(...imported.template.map(v => v.day));
      } else if (Object.keys(imported.weeks).length) {
        activeTab = 'week'; week = Object.keys(imported.weeks).sort()[0];
        selectedDay = imported.weeks[week].length ? Math.min(...imported.weeks[week].map(v => v.day)) : 0;
      } else activeTab = 'people';
      render();
    }, 'Importa');
  } catch (error) { tell(error instanceof SyntaxError ? 'Il file non contiene un JSON valido.' : error.message, true); }
  event.target.value = '';
};
$('generateButton').onclick = () => {
  if (!weekRows().length) { tell('Aggiungi almeno una fascia alla settimana.', true); return; }
  const driveCounts = new Map();
  lastPlan = DAYS.map((name, day) => {
    const result = planDay(weekRows().filter(v => v.day === day), state.people, state.settings, driveCounts);
    for (const trip of result.trips) if (trip.direction === 'out') for (const car of trip.cars) driveCounts.set(car.driver, (driveCounts.get(car.driver) || 0) + 1);
    return { name, day, result };
  });
  const output = $('planOutput'); output.replaceChildren();
  const failed = lastPlan.filter(p => !p.result.ok).length, journeys = lastPlan.reduce((sum, p) => sum + p.result.carJourneys, 0), summary = node('div', undefined, 'plan-summary');
  summary.append(node('p', failed ? `${failed} giorni da sistemare. ${journeys} viaggi in auto nei giorni già organizzabili.` : `${journeys} viaggi in auto per la settimana. Andate e ritorni sono conteggiati separatamente.`));
  summary.append(button('Scarica il piano', () => download(`piano-viaggi-${week}.txt`, planText(), 'text/plain'), 'secondary')); output.append(summary);
  for (const { name, day, result } of lastPlan) {
    if (!result.trips.length && result.ok) continue;
    const section = node('section', undefined, 'plan-day'); section.append(node('h3', `${name} ${formatDate(addDays(week, day))}`));
    if (!result.ok) {
      const warning = node('div', undefined, 'warning'); warning.append(node('strong', 'Nessun piano completo per questo giorno.'));
      const list = node('ul'); result.issues.forEach(issue => list.append(node('li', issue))); warning.append(list); section.append(warning);
    } else for (const trip of result.trips) {
      const row = node('div', undefined, 'trip'), timing = node('div'), cars = node('div');
      timing.append(node('div', trip.departure, 'trip-time'), node('div', trip.direction === 'out' ? `ANDATA · a scuola alle ${trip.arrival}` : `RITORNO · al ritrovo alle ${trip.arrival}`, 'trip-kind'));
      for (const car of trip.cars) {
        const names = ids => ids.map(id => state.people.find(p => p.id === id).name).join(', '), line = node('div', undefined, 'car-row');
        line.append(node('strong', names([car.driver])), node('span', ` guida · ${car.passengers.length ? `con ${names(car.passengers)}` : 'nessun passeggero'}`)); cars.append(line);
      }
      row.append(timing, cars); section.append(row);
    }
    output.append(section);
  }
  tell(failed ? 'Piano calcolato: controlla i giorni segnalati.' : 'Piano calcolato con il minimo numero di viaggi in auto per questi orari.');
};
function planText() {
  const lines = [`VIAGGI A SCUOLA · settimana del ${formatDate(week)}`, `Tratta: ${state.settings.travelMinutes} minuti. Posti per auto: ${state.settings.capacity}, conducente incluso.`, 'Orari esatti; ogni conducente porta e riporta la propria auto.', ''];
  if (state.importNotes.length) lines.push('Note degli orari importati:', ...state.importNotes, '');
  for (const { name, day, result } of lastPlan || []) {
    if (!result.trips.length && result.ok) continue;
    lines.push(`${name} ${formatDate(addDays(week, day))}`);
    if (!result.ok) lines.push('DA SISTEMARE: nessun piano completo.', ...result.issues);
    for (const trip of result.trips) {
      lines.push(`${trip.departure} ${trip.direction === 'out' ? 'Andata' : 'Ritorno'} (arrivo ${trip.arrival})`);
      for (const car of trip.cars) lines.push(`  Guida ${state.people.find(p => p.id === car.driver).name}; passeggeri: ${car.passengers.map(id => state.people.find(p => p.id === id).name).join(', ') || 'nessuno'}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
render();
