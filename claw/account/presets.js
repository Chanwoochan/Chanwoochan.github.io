import {canPublish, editorPreset, publicPreset, publishPreset} from './cloud.js';

const params = new URL(location.href).searchParams;
export const managing = params.get('manage') === '1';
export function previewDate() {
  const date = params.get('date');
  if (!managing || !date || !/^\d{4}-\d\d-\d\d$/.test(date)) return undefined;
  const time = Date.parse(date+'T12:00:00+09:00');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0,10)===date ? time : undefined;
}
function overlay(base, patch) {
  const merged = structuredClone(base);
  for (const group of ['config','cycle']) {
    for (const key of Object.keys(base[group])) {
      const value = patch?.[group]?.[key];
      if (Number.isFinite(value)) merged[group][key] = value;
    }
  }
  return merged;
}
export async function gameDefaults(factory, mode, date) {
  if (managing && !await canPublish()) throw Error('관리자 Google 계정으로 로그인한 뒤 로비에서 관리자 모드를 열어 주세요.');
  const get = managing ? editorPreset : publicPreset;
  const commonKey = date ? 'daily' : mode;
  const specific = date && (!managing || previewDate() !== undefined);
  const [common,day] = await Promise.all([get(commonKey),specific ? get('day-'+date) : null]);
  const commonBase = overlay(factory,common);
  const key = specific ? 'day-'+date : commonKey;
  const parent = specific ? commonBase : factory;
  let revision = (specific ? day : common)?.revision ?? 0;
  return {
    parent,
    values: specific ? overlay(commonBase,day) : commonBase,
    label: specific ? date+' 데일리' : ({daily:'데일리 공통',bridge:'하시와타시','hook-ring':'후크&링',cygnus:'시그너스'})[key],
    async publish(config,cycle) {
      const diff = {};
      for (const [group,data] of Object.entries({config,cycle})) {
        diff[group] = Object.fromEntries(Object.keys(parent[group])
          .filter(name => Number.isFinite(data[name]) && data[name] !== parent[group][name])
          .map(name => [name,data[name]]));
      }
      await publishPreset(key,revision,diff.config,diff.cycle);
      revision++;
    }
  };
}
