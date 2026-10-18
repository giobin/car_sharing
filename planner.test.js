import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, normalizeState, validateVisits, applyTemplate, planDay, monday, addDays, minutes } from './planner.js';

const settings = { capacity: 4, travelMinutes: 45 };
const person = (id, hasCar = true) => ({ id, name: id, hasCar });
const visit = (id, personId, start = '07:45', end = '12:45', day = 0) => ({ id, personId, day, start, end, site: 'common', note: '', needsReview: false });

test('Falcade is autonomous for the day, with no offered or requested shared seats', () => {
  for (const hasCar of [true, false]) {
    const people = [person('Anna'), person('Bruno', hasCar), person('Carla', false)];
    const shared = [visit('a','Anna'),visit('c','Carla')];
    const result = planDay([...shared,{...visit('b','Bruno'),site:'falcade'}],people,settings);
    checkPlan(result,shared,people,4);
    assert.deepEqual(result.autonomous,['Bruno']);
    assert.equal(result.carJourneys,2);
  }
});

test('Falcade cannot cover missing shared-route drivers, including mixed-site days', () => {
  const people = [person('Anna'),person('Bruno',false)];
  const rows = [visit('a','Anna','07:45','10:45'),{...visit('f','Anna','11:00','13:00'),site:'falcade'},visit('b','Bruno','07:45','10:45')];
  const result = planDay(rows,people,settings);
  assert.equal(result.ok,false);
  assert.deepEqual(result.trips,[]);
  assert.deepEqual(result.autonomous,['Anna']);
  assert.match(result.issues.join(' '), /0 disponibili/);
  assert.equal(people[0].hasCar,true);
  const nextDay = planDay([visit('a2','Anna','07:45','12:45',1),visit('b2','Bruno','07:45','12:45',1)],people,settings);
  assert.equal(nextDay.ok,true);
  assert.equal(nextDay.trips[0].cars[0].driver,'Anna');
});

test('Falcade-only days remain visible and do not use the common-route journey duration', () => {
  const result = planDay([{...visit('f','Anna','00:30','12:45'),site:'falcade'}],[person('Anna')],settings);
  assert.equal(result.ok,true);
  assert.equal(result.carJourneys,0);
  assert.deepEqual(result.trips,[]);
  assert.deepEqual(result.autonomous,['Anna']);
});

test('Falcade survives backup and weekly copies; old records default to common route', () => {
  const state = emptyState(); state.people = [person('Anna')]; state.template = [{...visit('f','Anna'),site:'falcade'}];
  const copy = normalizeState(JSON.parse(JSON.stringify(applyTemplate(state,'2026-10-19',()=> 'copy'))));
  assert.equal(copy.template[0].site,'falcade'); assert.equal(copy.weeks['2026-10-19'][0].site,'falcade');
  copy.weeks['2026-10-19'][0].site='common'; assert.equal(copy.template[0].site,'falcade');
  const old = structuredClone(state); delete old.template[0].site;
  assert.equal(normalizeState(old).template[0].site,'common');
  old.template[0].site='unknown'; assert.throws(()=>normalizeState(old),/Sede non valida/);
});
function checkPlan(result, visits, people, capacity) {
  assert.equal(result.ok, true);
  const driven = new Map();
  for (const trip of result.trips) {
    const expected = visits.filter(v => (trip.direction === 'out' ? v.start : v.end) === trip.time).map(v => v.personId).sort();
    const actual = trip.cars.flatMap(c => [c.driver, ...c.passengers]).sort();
    assert.deepEqual(actual, expected, 'Everyone rides exactly once on each leg');
    for (const car of trip.cars) {
      assert.equal(people.find(p => p.id === car.driver).hasCar, true);
      assert.ok(car.passengers.length + 1 <= capacity);
      const v = visits.find(v => v.personId === car.driver && (trip.direction === 'out' ? v.start : v.end) === trip.time);
      const legs = driven.get(v.id) || []; legs.push(trip.direction); driven.set(v.id, legs);
    }
  }
  for (const legs of driven.values()) assert.deepEqual(legs.sort(), ['back', 'out']);
  assert.deepEqual(result.trips.map(t => t.departure), result.trips.map(t => t.departure).sort());
}

test('morning and afternoon are four distinct legs for the same teacher', () => {
  const people = [person('Anna'), person('Bruno', false)];
  const rows = [visit('a1', 'Anna', '07:45', '11:45'), visit('a2', 'Anna', '14:00', '16:00'), visit('b1', 'Bruno', '07:45', '11:45'), visit('b2', 'Bruno', '14:00', '16:00')];
  const result = planDay(rows, people, settings);
  checkPlan(result, rows, people, 4);
  assert.deepEqual(result.trips.map(t => [t.direction, t.departure]), [['out', '07:00'], ['back', '11:45'], ['out', '13:15'], ['back', '16:00']]);
  assert.equal(result.carJourneys, 4);
});

test('one teacher can drive the morning and ride as passenger in the afternoon', () => {
  const people = [person('Anna'), person('Bruno'), person('Carlo', false)];
  const rows = [visit('b','Bruno','14:00','16:00'),visit('c','Carlo','14:00','16:00'),visit('a1','Anna','07:45','11:45'),visit('a2','Anna','14:00','16:00')];
  const result = planDay(rows, people, settings);
  checkPlan(result, rows, people, 4);
  assert.equal(result.carJourneys, 4);
  assert.equal(result.trips.find(t=>t.time==='07:45').cars[0].driver,'Anna');
  assert.ok(result.trips.find(t=>t.time==='14:00').cars[0].passengers.includes('Anna'));
});

test('shared outbound with different returns may require more outbound cars', () => {
  const people = [person('Anna'), person('Bruno'), person('Carlo', false)];
  const rows = [visit('a', 'Anna', '07:45', '11:45'), visit('b', 'Bruno', '07:45', '12:45'), visit('c', 'Carlo', '07:45', '12:45')];
  const result = planDay(rows, people, settings); checkPlan(result, rows, people, 4);
  assert.equal(result.trips.find(t => t.direction === 'out').cars.length, 2);
});

test('missing drivers or seats never promotes a passenger without a car', () => {
  for (const people of [[person('Anna', false)], [person('Anna'), ...['b','c','d','e'].map(n => person(n, false))]]) {
    const result = planDay(people.map((p, i) => visit(`v${i}`, p.id)), people, settings);
    assert.equal(result.ok, false); assert.deepEqual(result.trips, []); assert.match(result.issues.join(' '), /auto necessarie/);
  }
});

test('reject overlaps, duplicate visits and impossible intermediate round trips', () => {
  const people = [person('Anna')];
  assert.throws(() => validateVisits([visit('a','Anna'), visit('b','Anna')], people, 45), /sovrappongono/);
  assert.throws(() => validateVisits([visit('a','Anna'), visit('a','Anna')], people, 45), /duplicato/);
  const impossible = [visit('a','Anna','07:45','12:45'),visit('b','Anna','13:45','16:45')];
  assert.equal(planDay(impossible, people, settings).ok, false);
  assert.equal(planDay([visit('a','Anna','07:45','12:30'),visit('b','Anna','14:00','16:45')], people, settings).ok, true);
});

test('invalid times, unknown people, capacity and date values fail clearly', () => {
  for (const value of ['24:00','9:00','12:60','bad',null]) assert.throws(() => minutes(value));
  assert.throws(() => planDay([visit('a','unknown')], [], settings), /inesistente/);
  for (const capacity of [0, 1.5, 10, NaN]) assert.throws(() => planDay([], [], { ...settings, capacity }));
  assert.throws(() => monday('2026-02-30'));
  assert.throws(() => validateVisits([visit('a','Anna','00:30','12:00')], [person('Anna')], 45));
});

test('Monday/date arithmetic is stable across DST and year boundaries', () => {
  assert.equal(monday('2026-10-25'), '2026-10-19');
  assert.equal(addDays('2026-10-19', 7), '2026-10-26');
  assert.equal(monday('2027-01-01'), '2026-12-28');
});

test('template copies are independent and existing/empty weeks are protected', () => {
  const state = emptyState(); state.people = [person('Anna')]; state.template = [visit('template','Anna')];
  const applied = applyTemplate(state, '2026-10-19', () => 'copy');
  applied.weeks['2026-10-19'][0].end = '11:45';
  assert.equal(state.template[0].end, '12:45');
  assert.throws(() => applyTemplate(applied, '2026-10-19', () => 'another'), /già stata/);
  applied.weeks['2026-10-19'] = [];
  assert.throws(() => applyTemplate(applied, '2026-10-19', () => 'another'), /già stata/);
  assert.equal(applyTemplate(applied, '2026-10-19', () => 'another', true).weeks['2026-10-19'].length, 1);
});

test('backup roundtrip preserves multiple visits, empty weeks, notes and review status', () => {
  const state = emptyState(); state.people = [person('Anna')];
  state.template = [visit('a','Anna','07:45','11:45'),{...visit('b','Anna','14:00','16:00'), needsReview: true, note: 'Verificare'}];
  state.weeks['2026-10-19'] = []; state.importNotes = ['F e D da confermare'];
  assert.deepEqual(normalizeState(JSON.parse(JSON.stringify(state))), state);
  assert.equal(planDay(state.template, state.people, settings).ok, false);
  const corrupt = structuredClone(state); corrupt.template[0].personId = 'missing';
  assert.throws(() => normalizeState(corrupt), /inesistente/);
});

test('imports old dated backups and named weekdays without dropping split shifts', () => {
  const result = normalizeState({ people: [{ name:'Anna',hasCar:true }], days: [{date:'2025-10-29',shifts:[{person:'Anna',start:'07:45',end:'11:45'},{person:'Anna',start:'14:00',end:'16:00'}]}] });
  assert.equal(result.weeks['2025-10-27'].length, 2); assert.equal(result.weeks['2025-10-27'][0].day, 2);
  const named = normalizeState({people:['Anna'],days:[{name:'Sabato',shifts:[{person:'Anna',start:'07:45',end:'12:45'}]}]});
  assert.equal(named.template[0].day, 5); assert.equal(named.people[0].hasCar, false);
});

test('equal-cost plans prefer the colleague who has driven less this week', () => {
  const people = [person('Anna'),person('Bruno')], rows = [visit('a','Anna'),visit('b','Bruno')];
  assert.equal(planDay(rows, people, settings, new Map([['Anna',3]])).trips[0].cars[0].driver, 'Bruno');
});

test('capacity one and empty days are handled', () => {
  const people = [person('Anna'),person('Bruno')], rows = [visit('a','Anna'),visit('b','Bruno')];
  checkPlan(planDay(rows,people,{...settings,capacity:1}),rows,people,1);
  assert.deepEqual(planDay([],people,settings).trips, []);
});

test('optimizer matches exhaustive minimum over 300 deterministic small cases', () => {
  let seed = 937;
  const random = () => { seed = (Math.imul(seed,1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let sample = 0; sample < 300; sample++) {
    const count = 2 + Math.floor(random()*7), capacity = 1 + Math.floor(random()*4);
    const people = Array.from({length:count},(_,i)=>person(`p${i}`,random()>.25));
    const rows = people.map((p,i)=>visit(`v${i}`,p.id,['07:45','08:45','09:45'][Math.floor(random()*3)],['11:45','12:45','13:00'][Math.floor(random()*3)]));
    const candidates = rows.filter(v=>people.find(p=>p.id===v.personId).hasCar);
    let best = Infinity;
    for (let mask=0;mask<2**candidates.length;mask++) {
      const selected = candidates.filter((_,i)=>mask&(1<<i));
      const valid = ['start','end'].every(key=>[...new Set(rows.map(v=>v[key]))].every(at=>selected.filter(v=>v[key]===at).length*capacity>=rows.filter(v=>v[key]===at).length));
      if(valid) best=Math.min(best,selected.length);
    }
    const result = planDay(rows,people,{...settings,capacity});
    assert.equal(result.ok,Number.isFinite(best),`sample ${sample}`);
    if(result.ok){assert.equal(result.carJourneys/2,best,`sample ${sample}`);checkPlan(result,rows,people,capacity);}
  }
});
