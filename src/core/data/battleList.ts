import { CAMPAIGNS_B64 } from './battlePacks/campaigns_b64'
import { CONQUESTS_B64 } from './battlePacks/conquests_b64'

export interface BattleEntry {
  name: string
  file: string
  file2?: string
  map: number
  hide: number
  commander?: string
  countries?: string
  age: string
}

export interface BattleLineEntry {
  name: string
  hide: number
  start: number
  end: number
  countries: string
}

const RAW = `\
1 zone 1|campaign1_01.btl||1|0|Treville||1793
1 zone 2|campaign1_02.btl||1|0|Berthier||1796
1 zone 3|campaign1_03.btl||1|0|Massena||1797
1 zone 4|campaign1_04.btl||1|0|Desaix||1798
1 zone 5|campaign1_05.btl||1|1|Savary||1799
1 zone 6|campaign1_06.btl||1|0|Desaix||1800
1 zone 7|campaign1_07.btl||1|0|Napoleon||1805
1 zone 8|campaign1_08.btl||1|0|Murat||1806
1 zone 9|campaign1_09.btl||1|0|Ney||1807
1 zone 10|campaign1_10.btl||1|0|Junot||1808
1 zone 11|campaign1_11.btl||1|0|MacDonald||1809
1 zone 12|campaign1_12.btl||1|0|Murat||1812
1 zone 13|campaign1_13.btl||1|0|Ney||1812
1 zone 14|campaign1_14.btl||1|0|Murat||1813
1 zone 15|campaign1_15.btl||1|0|Napoleon||1815
1 zone 16|campaign1_16.btl||1|0|Grouchy||1817
1 zone 17|campaign1_17.btl||1|0|Oudinot||1818
1 zone 18|campaign1_18.btl||1|1|Jourdan||1820
2 zone 1|campaign2_01.btl||1|0|Archduke.C||1793
2 zone 2|campaign2_02.btl||1|0|Hood||1793
2 zone 3|campaign2_03.btl||1|0|Nelson||1798
2 zone 4|campaign2_04.btl||1|0|Radetzky||1799
2 zone 5|campaign2_05.btl||1|1|Bagration||1799
2 zone 6|campaign2_06.btl||1|0|Nelson||1801
2 zone 7|campaign2_07.btl||1|0|Nelson||1805
2 zone 8|campaign2_08.btl||1|0|Kutuzov||1805
2 zone 9|campaign2_09.btl||1|0|Blucher||1806
2 zone 10|campaign2_10.btl||1|0|Barclay||1807
2 zone 11|campaign2_11.btl||1|0|Wellesley||1807
2 zone 12|campaign2_12.btl||1|0|Palafox||1809
2 zone 13|campaign2_13.btl||1|0|Archduke.C||1809
2 zone 14|campaign2_14.btl||1|1|Archduke.C||1812
2 zone 15|campaign2_15.btl||1|0|Blucher||1813
2 zone 16|campaign2_16.btl||1|0|Wellesley||1815
2 zone 17|campaign2_17.btl||1|0|Wellesley||1815
3 zone 1|campaign3_01.btl||1|0|Dornberg||1810
3 zone 2|campaign3_02.btl||1|0|Kienmayer||1811
3 zone 3|campaign3_03.btl||1|0|Radetzky||1812
3 zone 4|campaign3_04.btl||1|0|Blucher||1813
3 zone 5|campaign3_05.btl||1|0|Merveldt||1813
3 zone 6|campaign3_06.btl||1|0|Blucher||1813
3 zone 7|campaign3_07.btl||1|0|Blucher||1814
3 zone 8|campaign3_08.btl|campaign3_08b.btl|1|0|Deroy|pru,aus|1815
3 zone 9|campaign3_09.btl||1|0|Yorck||1816
3 zone 10|campaign3_10.btl||1|0|Blucher||1817
3 zone 11|campaign3_11.btl||1|0|Archduke.C||1818
3 zone 12|campaign3_12.btl||1|1|Archduke.C||1819
3 zone 13|campaign3_13.btl||1|0|Radetzky||1820
3 zone 14|campaign3_14.btl||1|1|Yorck||1820
3 zone 15|campaign3_15.btl||1|0|JohannI||1821
4 zone 1|campaign4_01.btl||1|0|Milinovic||1798
4 zone 2|campaign4_02.btl||1|0|Wittgenstein||1804
4 zone 3|campaign4_03.btl||1|0|Pasha||1805
4 zone 4|campaign4_04.btl||1|0|Barclay||1808
4 zone 5|campaign4_05.btl||1|0|Pasha||1809
4 zone 6|campaign4_06.btl||1|0|SelimIII||1810
4 zone 7|campaign4_07.btl||1|0|Raevsky||1812
4 zone 8|campaign4_08.btl||1|0|Kutuzov||1812
4 zone 9|campaign4_09.btl||1|0|AlexanderI||1813
4 zone 10|campaign4_10.btl|campaign4_10b.btl|1|0|Milinovic|tur,rus|1814
4 zone 11|campaign4_11.btl||1|1|Pasha|tur|1815
4 zone 12|campaign4_12.btl||1|1|Bennigsen|rus|1815
4 zone 13|campaign4_13.btl||1|0|Golitsyn|gbr|1818
5 zone 1|campaign5_01.btl||1|0|Arnold||1775
5 zone 2|campaign5_02.btl||1|0|Dearborn||1777
5 zone 3|campaign5_03.btl||1|0|Dearborn||1781
5 zone 4|campaign5_04.btl||1|0|Jackson||1798
5 zone 5|campaign5_05.btl||1|1|Hull||1800
5 zone 6|campaign5_06.btl||1|0|Dearborn||1812
5 zone 7|campaign5_07.btl||1|0|Jackson||1813
5 zone 8|campaign5_08.btl||1|0|Jackson||1815
5 zone 9|campaign5_09.btl||1|1|Jackson||1817
5 zone 10|campaign5_10.btl||1|0|Dearborn||1820
5 zone 11|campaign5_11.btl||1|0|Dearborn||1821
6 zone 1|campaign6_01.btl||1|0|Brock||1775
6 zone 2|campaign6_02.btl||1|0|Clinton||1781
6 zone 3|campaign6_03.btl||1|0|Rowland||1793
6 zone 4|campaign6_04.btl||1|0|Nelson||1798
6 zone 5|campaign6_05.btl||1|0|Collingwood||1800
6 zone 6|campaign6_06.btl||1|0|Nelson||1801
6 zone 7|campaign6_07.btl||1|0|Wellesley||1808
6 zone 8|campaign6_08.btl||1|0|Duckworth||1809
6 zone 9|campaign6_09.btl||1|1|Dearborn||1811
6 zone 10|campaign6_10.btl||1|0|Wellesley||1814`

export const CAMPAIGN_BATTLES: BattleEntry[] = RAW.split('\n').map((line) => {
  const [name, file, file2, map, hide, commander, countries, age] = line.split('|')
  return {
    name,
    file,
    file2: file2 || undefined,
    map: parseInt(map, 10) || 1,
    hide: parseInt(hide, 10) || 0,
    commander: commander || undefined,
    countries: countries || undefined,
    age: age || '',
  }
})

export const BATTLE_LINES: BattleLineEntry[] = [
  { name: 'imperialeagle', hide: 0, start: 1793, end: 1820, countries: 'fra' },
  { name: 'coalition', hide: 0, start: 1792, end: 1815, countries: 'aus,pru,rus,gbr' },
  { name: 'romanempire', hide: 0, start: 1807, end: 1822, countries: 'hre,aus,pru' },
  { name: 'eastern', hide: 0, start: 1798, end: 1820, countries: 'tur,rus' },
  { name: 'america', hide: 0, start: 1775, end: 1822, countries: 'usa' },
  { name: 'neversets', hide: 0, start: 1775, end: 1814, countries: 'gbr' },
]

/** 返回第 N 章节（1-based）的所有关卡 */
export function battlesForChapter(chapterIdx: number): BattleEntry[] {
  const prefix = `${chapterIdx} zone `
  return CAMPAIGN_BATTLES.filter((b) => b.name.startsWith(prefix))
}

/** 从 "1 zone 5" 中解析出关卡序号（5） */
export function parseBattleZoneIdx(name: string): number {
  const m = name.match(/^\d+ zone (\d+)$/)
  return m ? parseInt(m[1], 10) : 0
}

export interface ConquestEntry {
  id: number
  file: string
  ageKey: string
}

export const CONQUEST_MAPS: ConquestEntry[] = [
  { id: 1, file: 'conquest1.btl', ageKey: 'text_conquest_age_1' },
  { id: 2, file: 'conquest2.btl', ageKey: 'text_conquest_age_2' },
  { id: 3, file: 'conquest3.btl', ageKey: 'text_conquest_age_3' },
  { id: 4, file: 'conquest4.btl', ageKey: 'text_conquest_age_4' },
  { id: 5, file: 'conquest5.btl', ageKey: 'text_conquest_age_5' },
  { id: 6, file: 'conquest6.btl', ageKey: 'text_conquest_age_6' },
]

export const CONQUEST_DEFAULT_AGES = [
  '欧洲 1798',
  '美洲 1775',
  '欧洲 1806',
  '欧洲 1809',
  '美洲 1812',
  '欧洲 1815',
]



function b64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64)
  const len = bin.length
  const buf = new ArrayBuffer(len)
  const view = new Uint8Array(buf)
  for (let i = 0; i < len; i++) view[i] = bin.charCodeAt(i)
  return buf
}

export async function loadCampaignBtl(file: string): Promise<ArrayBuffer> {
  const b64 = CAMPAIGNS_B64[file]
  if (!b64) {
    throw new Error(
      `未找到内嵌战役「${file}」。\n` +
      `请确认已将 ${file} 放入 public/campaigns/ 并重新运行 node scripts/bin2ts.mjs`
    )
  }
  return b64ToArrayBuffer(b64)
}

export async function loadConquestBtl(file: string): Promise<ArrayBuffer> {
  const b64 = CONQUESTS_B64[file]
  if (!b64) {
    throw new Error(
      `未找到内嵌征服「${file}」。\n` +
      `请确认已将 ${file} 放入 public/conquests/ 并重新运行 node scripts/bin2ts.mjs`
    )
  }
  return b64ToArrayBuffer(b64)
}