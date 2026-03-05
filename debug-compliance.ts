import { runElectricalCalc } from './lib/electrical-calc';

const input = {
  inverters: [{
    type: 'micro' as const,
    modulesPerDevice: 1,
    deviceCount: 34,
    acOutputKw: 0.295,
    acOutputCurrentMax: 1.21,
    maxDcVoltage: 60,
    mpptVoltageMin: 16,
    mpptVoltageMax: 60,
    maxInputCurrentPerMppt: 14,
    strings: [{
      panelCount: 34,
      panelVoc: 41.6,
      panelIsc: 12.26,
      panelImp: 11.59,
      panelVmp: 34.5,
      panelWatts: 400,
      tempCoeffVoc: -0.26,
      tempCoeffIsc: 0.05,
      maxSeriesFuseRating: 20,
      wireGauge: '#10 AWG',
      wireLength: 50,
      conduitType: 'EMT',
    }],
  }],
  mainPanelAmps: 225,
  systemVoltage: 240,
  designTempMin: -10,
  designTempMax: 40,
  rooftopTempAdder: 30,
  wireGauge: '#10 AWG',
  wireLength: 50,
  conduitType: 'EMT',
  rapidShutdown: true,
  acDisconnect: true,
  dcDisconnect: true,
  necVersion: '2023' as const,
};

const result = runElectricalCalc(input);
console.log('Status:', result.status);
console.log('Errors:', result.errors?.map(e => e.message));
console.log('Warnings:', result.warnings?.map(w => w.message));
console.log('Infos:', result.infos?.map(i => i.message));