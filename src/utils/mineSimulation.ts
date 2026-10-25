export type MiningAssetId =
  | 'truck-01'
  | 'truck-02'
  | 'truck-03'
  | 'truck-04'
  | 'truck-05'
  | 'ex-01'
  | 'ex-02'
  | 'ex-03'
  | 'drill-01'
  | 'drill-02'
  | 'crusher'
  | 'radar'
  | 'waste-dump';

export interface ScenarioState {
  ex1Fail: boolean;
  roadBlock: boolean;
  dilution: boolean;
}

export type TruckFsmPhase =
  | 'LOADING'
  | 'HAULING_UP'
  | 'DUMPING'
  | 'RETURNING_EMPTY';

export interface TruckTelemetry {
  id: 'truck-01' | 'truck-02' | 'truck-03' | 'truck-04' | 'truck-05';
  name: string;
  shovel: string;
  bench: string;
  payload: number;
  grade: number;
  speed: number;
  state: 'HAULING' | 'RETURNING' | 'REROUTED' | 'STANDBY';
  fsmPhase?: TruckFsmPhase;
  oreType: 'malachite' | 'sulfide' | 'overburden';
  tirePressureBar: number;
  tkph: number;
  fuelLph: number;
  etaMin: number;
}

export interface TelemetryLog {
  time: string;
  text: string;
  type: 'info' | 'alert' | 'success';
}

export interface MineTelemetryState {
  simTimeMin: number;
  feedGradeCu: number;
  targetGradeCu: number;
  minedTonnes: number;
  crusherTph: number;
  fleetFuelLph: number;
  radarStatus: 'NORMAL' | 'ALERT_COLLAPSE';
  radarDispMmDay: number;
  activeScenarios: ScenarioState;
  logs: TelemetryLog[];
  trucks: TruckTelemetry[];
}

export function computeScenarioMetrics(
  scenarios: ScenarioState,
  baseTrucks: TruckTelemetry[]
): {
  feedGradeCu: number;
  crusherTph: number;
  fleetFuelLph: number;
  radarStatus: 'NORMAL' | 'ALERT_COLLAPSE';
  radarDispMmDay: number;
  trucks: TruckTelemetry[];
} {
  let feedGradeCu = 0.480;
  let crusherTph = 2270;
  let fleetFuelLph = 426;

  if (scenarios.ex1Fail && scenarios.dilution) {
    feedGradeCu = 0.365;
    crusherTph = 1680;
  } else if (scenarios.ex1Fail) {
    feedGradeCu = 0.412;
    crusherTph = 1820;
  } else if (scenarios.dilution) {
    feedGradeCu = 0.365;
    crusherTph = 2190;
  }

  if (scenarios.roadBlock) {
    fleetFuelLph = 498; // Detour +1.4 km increases fuel burn
    crusherTph = Math.max(1540, crusherTph - 190);
  }

  const radarStatus: 'NORMAL' | 'ALERT_COLLAPSE' = scenarios.roadBlock
    ? 'ALERT_COLLAPSE'
    : 'NORMAL';
  const radarDispMmDay = scenarios.roadBlock ? 14.80 : 0.20;

  const updatedTrucks: TruckTelemetry[] = baseTrucks.map((t) => {
    let grade = t.grade;
    let speed = t.speed;
    let state = t.state;
    let shovel = t.shovel;
    let fuelLph = t.fuelLph;
    let etaMin = t.etaMin;

    if ((t.id === 'truck-01' || t.id === 'truck-02') && scenarios.ex1Fail) {
      shovel = 'EX-02 (+220м, Резерв)';
      grade = scenarios.dilution ? 0.22 : 0.40;
      state = 'REROUTED';
      etaMin = +(t.etaMin + 1.4).toFixed(1);
    } else if (t.id === 'truck-03' || t.id === 'truck-04') {
      grade = scenarios.dilution ? 0.22 : 0.40;
      if (scenarios.roadBlock) {
        state = 'REROUTED';
        speed = t.id === 'truck-04' ? 32.0 : 12.8;
        fuelLph = t.id === 'truck-04' ? 76 : 134;
        etaMin = +(t.etaMin + 2.1).toFixed(1);
      } else {
        state = t.id === 'truck-04' ? 'RETURNING' : 'HAULING';
        speed = t.id === 'truck-04' ? 38.0 : 14.5;
      }
    } else if (t.id === 'truck-01' || t.id === 'truck-02') {
      shovel = 'EX-01 (+280м, Малахит)';
      grade = 0.64;
      state = 'HAULING';
    }

    return {
      ...t,
      shovel,
      grade,
      speed,
      state,
      fuelLph,
      etaMin,
    };
  });

  return {
    feedGradeCu,
    crusherTph,
    fleetFuelLph,
    radarStatus,
    radarDispMmDay,
    trucks: updatedTrucks,
  };
}

export interface ShovelPose {
  swingAngle: number;
  boomPitch: number;
  stickExtension: number;
  bucketCurl: number;
}

export function computeShovelKinematics(
  timeSec: number,
  phaseOffset: number,
  halted: boolean
): ShovelPose {
  if (halted) {
    return {
      swingAngle: -0.25,
      boomPitch: 0,
      stickExtension: -0.8,
      bucketCurl: -0.35,
    };
  }

  const cycle = (((timeSec * 0.45 + phaseOffset) % 1) + 1) % 1;
  let swingAngle = 0;
  let stickExtension = 0;
  let bucketCurl = 0;
  const boomPitch = Math.sin(cycle * Math.PI * 2) * 0.012;

  if (cycle < 0.32) {
    const u = cycle / 0.32;
    const smooth = u * u * (3 - 2 * u);
    swingAngle = 0;
    stickExtension = -0.6 + smooth * 1.4;
    bucketCurl = -0.2 + smooth * 0.55;
  } else if (cycle < 0.58) {
    const u = (cycle - 0.32) / 0.26;
    const smooth = u * u * (3 - 2 * u);
    swingAngle = smooth * 1.05;
    stickExtension = 0.8 + Math.sin(u * Math.PI) * 0.25;
    bucketCurl = 0.35;
  } else if (cycle < 0.72) {
    const u = (cycle - 0.58) / 0.14;
    swingAngle = 1.05;
    stickExtension = 0.8 - u * 0.3;
    bucketCurl = 0.35 - Math.sin(u * Math.PI) * 0.85;
  } else {
    const u = (cycle - 0.72) / 0.28;
    const smooth = u * u * (3 - 2 * u);
    swingAngle = 1.05 * (1 - smooth);
    stickExtension = 0.5 * (1 - smooth) - 0.6 * smooth;
    bucketCurl = 0.35 * (1 - smooth) - 0.2 * smooth;
  }

  return {
    swingAngle,
    boomPitch,
    stickExtension,
    bucketCurl,
  };
}

export function formatSimClock(simTimeMin: number): string {
  const totalMinutes = Math.floor(simTimeMin);
  const hours = Math.floor((8 * 60 + totalMinutes) / 60) % 24;
  const mins = (8 * 60 + totalMinutes) % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

export interface ScreenSpaceCalloutLayout {
  isVisible: boolean;
  screenX: number;
  screenY: number;
  cardX: number;
  cardY: number;
  placeLeft: boolean;
  svgPoints: string;
}

/**
 * Pure screen-space callout positioning and leader-line geometry calculator.
 * Enforces front-of-camera clipping and quadrant adaptation so the card never clips off-screen.
 */
export function computeScreenSpaceCalloutLayout(params: {
  ndcX: number;
  ndcY: number;
  ndcZ: number;
  isInFront: boolean;
  canvasWidth: number;
  canvasHeight: number;
  cardWidth?: number;
  cardHeight?: number;
}): ScreenSpaceCalloutLayout {
  const {
    ndcX,
    ndcY,
    ndcZ,
    isInFront,
    canvasWidth,
    canvasHeight,
    cardWidth = 320,
    cardHeight = 236,
  } = params;

  const isVisible = isInFront && ndcZ >= -1.0 && ndcZ <= 1.0;
  const screenX = (ndcX * 0.5 + 0.5) * canvasWidth;
  const screenY = (-(ndcY * 0.5) + 0.5) * canvasHeight;

  const sideMargin = canvasWidth >= 1200 ? 348 : 16;
  const placeLeft =
    screenX > canvasWidth * 0.65 ||
    (canvasWidth >= 1200 && screenX + cardWidth + 28 > canvasWidth - sideMargin);
  let cardX = placeLeft ? screenX - cardWidth - 28 : screenX + 28;
  cardX = Math.max(sideMargin, Math.min(canvasWidth - cardWidth - sideMargin, cardX));

  let cardY = screenY > canvasHeight * 0.7 ? screenY - cardHeight - 16 : screenY - 36;
  cardY = Math.max(68, Math.min(canvasHeight - cardHeight - 86, cardY));

  // Polyline from 3D screen anchor -> elbow -> card corner
  const targetX = placeLeft ? cardX + cardWidth : cardX;
  const targetY = cardY + 26;
  const elbowX = placeLeft ? Math.min(screenX - 14, targetX + 12) : Math.max(screenX + 14, targetX - 12);
  const elbowY = targetY;

  const svgPoints = `${screenX.toFixed(1)},${screenY.toFixed(1)} ${elbowX.toFixed(1)},${elbowY.toFixed(1)} ${targetX.toFixed(1)},${targetY.toFixed(1)}`;

  return {
    isVisible,
    screenX,
    screenY,
    cardX,
    cardY,
    placeLeft,
    svgPoints,
  };
}

export interface CalloutMetricRow {
  label: string;
  value: string;
  highlight?: 'sky' | 'emerald' | 'amber' | 'red';
}

export interface AssetCalloutDescriptor {
  assetId: MiningAssetId;
  category: 'truck' | 'shovel' | 'crusher' | 'drill' | 'radar' | 'waste';
  title: string;
  subtitle: string;
  badgeText: string;
  badgeTone: 'sky' | 'emerald' | 'amber' | 'red';
  rows: CalloutMetricRow[];
}

export function getAssetCalloutTelemetry(
  assetId: MiningAssetId,
  telemetry: MineTelemetryState
): AssetCalloutDescriptor {
  if (assetId.startsWith('truck-')) {
    const truck =
      telemetry.trucks.find((t) => t.id === assetId) || telemetry.trucks[0];
    const phase: TruckFsmPhase =
      truck.fsmPhase ??
      (truck.state === 'RETURNING' ? 'RETURNING_EMPTY' : 'HAULING_UP');

    const oreLabel =
      truck.oreType === 'malachite'
        ? 'Окисленный малахит'
        : truck.oreType === 'sulfide'
        ? 'Сульфидная руда'
        : 'Порода вскрыши';

    let badgeText = `ГРУЖЕНЫЙ ХОД (${truck.speed.toFixed(1)} км/ч)`;
    let badgeTone: 'sky' | 'emerald' | 'amber' | 'red' =
      truck.state === 'REROUTED' ? 'amber' : 'emerald';
    let payloadValue = `227 т • Cu ${truck.grade.toFixed(2)}% (${oreLabel})`;
    let payloadHighlight: 'sky' | 'emerald' | 'amber' | 'red' | undefined = 'sky';
    let fuelValue = '328 л/ч (Подъем на уступе)';

    if (phase === 'LOADING') {
      badgeText = 'ПОГРУЗКА В ЗАБОЕ (0.0 км/ч)';
      badgeTone = 'amber';
      payloadValue = 'Динамическая: 0 -> 227 т';
      payloadHighlight = 'amber';
      fuelValue = '45 л/ч (Холостой ход)';
    } else if (phase === 'DUMPING') {
      badgeText = 'РАЗГРУЗКА В БУНКЕР ККД-1 (0.0 км/ч)';
      badgeTone = 'amber';
      payloadValue = '227 -> 0 т';
      payloadHighlight = 'amber';
      fuelValue = '60 л/ч (Гидравлика кузова)';
    } else if (phase === 'RETURNING_EMPTY') {
      badgeText = `ПОРОЖНИЙ ВОЗВРАТ (${truck.speed.toFixed(1)} км/ч)`;
      badgeTone = 'sky';
      payloadValue = '0 т • Порожний';
      payloadHighlight = undefined;
      fuelValue = '88 л/ч (Спуск на ретардере)';
    }

    return {
      assetId,
      category: 'truck',
      title: truck.name,
      subtitle: 'Карьерный самосвал 227 т · Caterpillar',
      badgeText,
      badgeTone,
      rows: [
        { label: 'Прикрепленный забой', value: truck.shovel },
        {
          label: 'Масса груза и руда',
          value: payloadValue,
          highlight: payloadHighlight,
        },
        {
          label: 'Шины и индекс износа',
          value: `${truck.tirePressureBar.toFixed(1)} bar · ${truck.tkph} TKPH (норма)`,
        },
        {
          label: 'Мгновенный расход ДТ',
          value: fuelValue,
        },
        {
          label: 'Расчетный ETA до ККД',
          value: `~${truck.etaMin.toFixed(1)} мин`,
          highlight: 'emerald',
        },
      ],
    };
  }

  if (assetId === 'ex-01' || assetId === 'ex-02' || assetId === 'ex-03') {
    const isEx1 = assetId === 'ex-01';
    const isEx2 = assetId === 'ex-02';
    const isFailed = isEx1 && telemetry.activeScenarios.ex1Fail;
    const isDiluted = isEx2 && telemetry.activeScenarios.dilution;

    const horizonText = isEx1
      ? 'Горизонт +280м · Богатый малахит (0.64% Cu)'
      : isEx2
      ? `Горизонт +220м · Халькопирит (${isDiluted ? '0.22%' : '0.40%'} Cu)`
      : 'Горизонт +310м · Вскрышной уступ (0.08% Cu)';

    const cycleSec = isEx1 ? 26.8 : isEx2 ? 27.4 : 28.2;
    const tph = isFailed ? 0 : isEx1 ? 3520 : isEx2 ? 3450 : 3180;

    return {
      assetId,
      category: 'shovel',
      title: `Экскаватор ${assetId.toUpperCase()}`,
      subtitle: 'Электрический канатный экскаватор CAT 7495',
      badgeText: isFailed ? 'АВАРИЯ ПРИВОДА' : 'ОТГРУЗКА В ШТАТЕ',
      badgeTone: isFailed ? 'red' : isDiluted ? 'amber' : 'emerald',
      rows: [
        { label: 'Горизонт и тип забоя', value: horizonText, highlight: 'sky' },
        { label: 'Вместимость ковша', value: '33.6 м³ (~65 тонн)' },
        {
          label: 'Время цикла черпания',
          value: isFailed ? 'ОСТАНОВЛЕН' : `${cycleSec.toFixed(1)} сек`,
        },
        {
          label: 'Сменная производительность',
          value: `${tph.toLocaleString('ru-RU')} т/час`,
        },
        {
          label: 'Электропитание',
          value: isFailed
            ? '6.6 кВ · 0 кВт (АВАРИЯ ПРИВОДА)'
            : '6.6 кВ · 1 420 кВт (привод: НОРМА)',
          highlight: isFailed ? 'red' : 'emerald',
        },
      ],
    };
  }

  if (assetId === 'crusher') {
    const gradeInSpec =
      telemetry.feedGradeCu >= 0.44 && telemetry.feedGradeCu <= 0.52;
    return {
      assetId,
      category: 'crusher',
      title: 'Первичная дробилка ККД-1',
      subtitle: 'Конусная дробилка крупного дробления Metso 60-89',
      badgeText: `${telemetry.crusherTph} Т/Ч · В РАБОТЕ`,
      badgeTone: gradeInSpec ? 'emerald' : 'amber',
      rows: [
        {
          label: 'Производительность',
          value: `${telemetry.crusherTph.toLocaleString('ru-RU')} т/ч (номинал 3 200 т/ч)`,
          highlight: 'sky',
        },
        {
          label: 'Содержание Cu в шихте',
          value: `${telemetry.feedGradeCu.toFixed(3)}% (цель 0.480%)`,
          highlight: gradeInSpec ? 'emerald' : 'amber',
        },
        { label: 'Уровень руды в бункере', value: '68% (приемный зумпф)' },
        {
          label: 'Магистральный конвейер',
          value: '3.2 м/с (поток на рудоштабель)',
        },
      ],
    };
  }

  if (assetId === 'drill-01' || assetId === 'drill-02') {
    const isDrill1 = assetId === 'drill-01';
    return {
      assetId,
      category: 'drill',
      title: isDrill1 ? 'Буровой станок СБШ #01' : 'Буровой станок СБШ #02',
      subtitle: 'Станок вращательного взрывного бурения CAT MD6250',
      badgeText: isDrill1 ? 'БУРЕНИЕ +280м' : 'БУРЕНИЕ +250м',
      badgeTone: 'sky',
      rows: [
        {
          label: 'Назначение',
          value: 'Бурение скважин под эмульсионные ВВ (БВР)',
        },
        { label: 'Диаметр долота', value: '250 мм (шарошечное)' },
        {
          label: 'Глубина скважины',
          value: '15.0 м (включая перебур 1.8 м)',
        },
        { label: 'Скорость проходки (ROP)', value: '32.0 м/ч', highlight: 'emerald' },
        {
          label: 'Сетка скважин',
          value: '7.5м × 8.5м (блок готов к взрыву)',
        },
      ],
    };
  }

  if (assetId === 'radar') {
    const isAlert = telemetry.radarStatus !== 'NORMAL';
    return {
      assetId,
      category: 'radar',
      title: 'Георадар GroundProbe SSR-XT',
      subtitle: 'Радар мониторинга устойчивости бортов SSR-XT',
      badgeText: isAlert ? 'РИСК ОПОЛЗНЯ' : 'СКАНИРОВАНИЕ 360°',
      badgeTone: isAlert ? 'red' : 'emerald',
      rows: [
        {
          label: 'Сектор сканирования',
          value: 'Северо-восточный борт (+240м … +310м)',
        },
        {
          label: 'Скорость деформации',
          value: `${telemetry.radarDispMmDay.toFixed(2)} мм/сут`,
          highlight: isAlert ? 'red' : 'emerald',
        },
        {
          label: 'Статус геомеханики',
          value: isAlert
            ? 'КРИТИЧЕСКИЙ РИСК ОПОЛЗНЯ'
            : 'ШТАТНО (СМЕЩЕНИЙ НЕТ)',
          highlight: isAlert ? 'red' : 'emerald',
        },
        {
          label: 'Интерферометрия',
          value: 'Скан 360° каждые 2.0 мин · точность 0.1 мм',
        },
      ],
    };
  }

  return {
    assetId: 'waste-dump',
    category: 'waste',
    title: 'Северный отвал вскрыши',
    subtitle: 'Северный отвал вскрышных пород (+350м)',
    badgeText: 'ПРИЕМ ПОРОДЫ',
    badgeTone: 'sky',
    rows: [
      { label: 'Назначение', value: 'Размещение пустой породы (+350м)' },
      { label: 'Вместимость яруса', value: '18.4 млн м³', highlight: 'sky' },
      { label: 'Прием за смену', value: '8 400 т (маршрут EX-03)' },
      {
        label: 'Работающая техника',
        value: 'Бульдозер CAT D11T (формирование вала)',
        highlight: 'emerald',
      },
    ],
  };
}

/**
 * Continuous polar radius function for the asymmetric NE-striking porphyry copper stockwork pit.
 * Ensures seamless vertex stitching between surrounding steppe terrain, bench faces, berms, and haul roads.
 */
export function getBenchRadius(baseRadius: number, theta: number, _y = 0): number {
  const elongation = 1.0 + 0.14 * Math.cos(theta - 0.45) + 0.05 * Math.sin(2.0 * theta + 0.8);
  const macroBumps = 0.03 * Math.sin(4.0 * theta - 1.2) + 0.015 * Math.cos(7.0 * theta);
  return baseRadius * (elongation + macroBumps);
}
