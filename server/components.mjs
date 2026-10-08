// Under-hood components of a vehicle and their synthetic checks. Training simulation only: the layout, values and
// thresholds are invented for the demo and are not service data for a real Kia Sportage or any Allur vehicle.
import { hashNormal, hashUniform } from './equipment.mjs';

export const COMPONENTS = {
  engine: { name: 'Двигатель', removable: false, required: true },
  battery: { name: 'Аккумулятор', removable: true, required: true, stockItem: 'battery' },
  radiator: { name: 'Радиатор и вентилятор', removable: false, required: true },
  airbox: { name: 'Корпус воздушного фильтра', removable: true, required: true },
  coolant_tank: { name: 'Расширительный бачок', removable: true, required: true },
  washer_tank: { name: 'Бачок омывателя', removable: true, required: false },
  hoses: { name: 'Шланги охлаждения', removable: false, required: true },
};
export const COMPONENT_IDS = Object.keys(COMPONENTS);
// Scripted fault of the default demo scenario: the fifth vehicle of the shift leaves assembly with a weak battery.
export const SCRIPTED_FAULTS = [{ seq: 5, component: 'battery' }];
export const BATTERY_LOAD_MIN = 9.6, BATTERY_REST_MIN = 12.2;
export const START_SYMPTOM = 'Не запускается';
export const START_HYPOTHESIS = 'Предположение до измерений: чаще всего пуск срывает аккумулятор, который не держит пусковой ток; реже — плохой контакт клемм или стартер. Это гипотеза, а не подтверждённая неисправность — её проверяет измерение.';

const r1 = n => Math.round(n * 10) / 10, r2 = n => Math.round(n * 100) / 100;
const fmt = n => String(n).replace('.', ',');

// Deterministic synthetic measurement: depends only on the installed part's health, the vehicle and the check number.
export function measure(component, health, seed, vehicleId, n) {
  const z = key => hashNormal(seed, vehicleId, component, key, n);
  if (component === 'battery') {
    const rest = r2(health === 'ok' ? 12.62 + .04 * z('rest') : 11.71 + .05 * z('rest'));
    const load = r1(health === 'ok' ? 10.4 + .12 * z('load') : 7.9 + .15 * z('load'));
    const ok = load >= BATTERY_LOAD_MIN && rest >= BATTERY_REST_MIN;
    return {
      result: ok ? 'ok' : 'fault',
      measurements: [
        { name: 'Напряжение покоя', value: rest, unit: 'В', norm: `не ниже ${fmt(BATTERY_REST_MIN)}` },
        { name: 'Напряжение под нагрузкой (пусковой ток)', value: load, unit: 'В', norm: `не ниже ${fmt(BATTERY_LOAD_MIN)}` },
      ],
      text: ok ? `Под нагрузкой ${fmt(load)} В — выше порога ${fmt(BATTERY_LOAD_MIN)} В: аккумулятор держит пусковой ток.`
        : `Под нагрузкой напряжение падает до ${fmt(load)} В — ниже порога ${fmt(BATTERY_LOAD_MIN)} В: аккумулятор не держит пусковой ток. Неисправность подтверждена измерением.`,
    };
  }
  const ok = health === 'ok';
  const table = {
    engine: [{ name: 'Проворачивание коленвала вручную', value: ok ? 'свободно' : 'с заеданием' }, { name: 'Разъёмы датчиков', value: 'подключены' }],
    radiator: [{ name: 'Падение давления за 2 мин при 1,2 бар', value: ok ? r2(.02 + .01 * Math.abs(z('p'))) : .35, unit: 'бар', norm: 'не больше 0,1' }],
    airbox: [{ name: 'Фильтрующий элемент', value: 'установлен' }, { name: 'Крышка корпуса', value: 'закрыта' }],
    coolant_tank: [{ name: 'Уровень охлаждающей жидкости', value: ok ? 'между MIN и MAX' : 'ниже MIN' }],
    washer_tank: [{ name: 'Уровень жидкости', value: ok ? 'норма' : 'пусто' }],
    hoses: [{ name: 'Шланги и хомуты', value: ok ? 'без подтёков' : 'подтёк' }],
  }[component];
  return { result: ok ? 'ok' : 'fault', measurements: table, text: ok ? 'Отклонений не найдено.' : 'Найдено отклонение — узел требует замены или ремонта.' };
}

// Door gap defect (quality control finding «Зазор двери вне допуска»). Synthetic training values: the nominal gap,
// tolerance and adjustment effect are invented for the demo; this is not a body-repair procedure for a real vehicle.
export const DOOR_GAP = { nominal: 4.0, tolerance: 1.0, unit: 'мм', name: 'Зазор по контуру двери' };
const DOOR_SIDES = ['передней левой', 'передней правой', 'задней левой', 'задней правой'];
export const doorSide = (seed, vehicleId) => DOOR_SIDES[Math.floor(hashUniform(seed, vehicleId, 'door-side') * DOOR_SIDES.length)];
export const doorGapInitial = (seed, vehicleId) => r1(6.2 + 1.4 * hashUniform(seed, vehicleId, 'door-gap'));
// One adjustment of hinges and striker removes most of the deviation; the result is measured, not assumed.
export const doorGapAfterAdjust = (gap, seed, vehicleId, n) => r2(DOOR_GAP.nominal + (gap - DOOR_GAP.nominal) * .12 + .15 * hashNormal(seed, vehicleId, 'door-adjust', n));
export function doorMeasure(gap, seed, vehicleId, n) {
  const value = r1(gap + .08 * hashNormal(seed, vehicleId, 'door-measure', n)), deviation = r1(value - DOOR_GAP.nominal);
  const ok = Math.abs(value - DOOR_GAP.nominal) <= DOOR_GAP.tolerance;
  return { value, deviation, ok, text: ok ? `Зазор ${fmt(value)} мм — в допуске ${fmt(DOOR_GAP.nominal)} ± ${fmt(DOOR_GAP.tolerance)} мм.` : `Зазор ${fmt(value)} мм — вне допуска ${fmt(DOOR_GAP.nominal)} ± ${fmt(DOOR_GAP.tolerance)} мм (отклонение ${deviation > 0 ? '+' : ''}${fmt(deviation)} мм). Нужна регулировка.` };
}

// Start test: the starter cranks from the battery; a weak battery means slow cranking and no start.
export function startTest(components, seed, vehicleId, n) {
  const battery = components.battery, z = hashNormal(seed, vehicleId, 'start', n);
  const weak = Object.entries(components).filter(([, c]) => c.status === 'installed' && c.health !== 'ok').map(([id]) => id);
  const crank = r1(battery.health === 'ok' ? 10.2 + .12 * z : 7.7 + .15 * z);
  const passed = weak.length === 0;
  return {
    result: passed ? 'pass' : 'fail',
    measurements: [{ name: 'Напряжение при прокрутке стартером', value: crank, unit: 'В', norm: `не ниже ${fmt(BATTERY_LOAD_MIN)}` }, { name: 'Пуск двигателя', value: passed ? `за ${fmt(r1(1.1 + .1 * Math.abs(z)))} с` : 'не произошёл' }],
    text: passed ? 'Двигатель запустился, холостой ход устойчивый. Проверка запуска пройдена.' : 'Стартер проворачивает медленно, двигатель не запускается. Проверка запуска не пройдена.',
  };
}
