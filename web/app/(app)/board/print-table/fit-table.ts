/**
 * auto-fit ของตารางบอร์ดงาน — "ตัวอักษรใหญ่ที่สุดเท่าที่ทุกช่องยังอยู่บรรทัดเดียว"
 *
 * ทำไมต้องมีไฟล์นี้: เดิมความกว้างคอลัมน์ (`weight`) กับขนาดฟอนต์ (`fontPtFor`) เป็นเลขตายตัว
 * ที่ถอดมาจากไฟล์ต้นแบบ → ชื่อยายาว ๆ ตกไป 2–3 บรรทัด ส่วนคอลัมน์อย่าง "ชนิด/หน่วย" ว่างครึ่งช่อง
 * ที่ถูกคือวัดความกว้างข้อความจริงก่อน แล้วคำนวณย้อนกลับว่าฟอนต์โตได้แค่ไหน คอลัมน์ควรกว้างเท่าไร
 *
 * 🚨 ไฟล์นี้ต้องเป็นคณิตศาสตร์ล้วน ห้ามแตะ DOM — คนเรียก (print-table-view.tsx) เป็นคนวัดมาให้
 *    เหตุผล: การวัดต้องเกิดที่ขนาดฟอนต์คงที่ (FIT_REF_PT) เท่านั้น ถ้าให้ไฟล์นี้อ่าน DOM เอง
 *    วันหนึ่งจะมีคนเผลอวัดตอนที่ตารางใช้ขนาดที่ fit คำนวณไว้แล้ว = input ขึ้นกับ output ของตัวเอง
 *    แล้ว useLayoutEffect จะวนไม่จบ
 */

/** ขนาดฟอนต์ที่ตัวชั่งวัด `.pt-fit` ใช้เสมอ — ตรึงไว้ ห้ามผูกกับผลลัพธ์ */
export const FIT_REF_PT = 10;

/** หัวตารางดันคอลัมน์ให้กว้างเกินข้อมูลได้ไม่เกินเท่านี้ (เช่น "ขนาดบรรจุ (1)" คร่อมช่องที่มีแต่ "-") */
const HEADER_CAP = 1.25;

/**
 * แต่หัวตารางก็ต้องอ่านออก — บีบได้มากสุดเหลือเท่านี้ของความกว้างเต็ม
 * 🚨 ห้ามเอาออก: คอลัมน์ที่ข้อมูลเป็น "-" ล้วน (เช่น ขนาดบรรจุ (2)) dataMax แทบเป็น 0
 *    ถ้าเชื่อ HEADER_CAP อย่างเดียวคอลัมน์จะแคบจนหัวตารางโดนบีบเหลือ 10% = อ่านไม่ออก
 */
const HEADER_MIN_SCALE = 0.75;

/** คอลัมน์เดียวกินความกว้างข้อความได้ไม่เกินสัดส่วนนี้ — กันชื่อยายาวผิดปกติ 1 ตัวย่อทั้งตาราง */
const DEFAULT_CAP_SHARE = 0.3;

/** เพดานความปลอดภัยของขนาดฟอนต์ที่ผู้ใช้บังคับเอง (pt) */
const FORCED_MIN_PT = 4;
const FORCED_MAX_PT = 30;

export type FitInput = {
  /** ความกว้างข้อความจริงของทุกช่อง (px) วัดที่ `refPt` · แถว 0 = หัวตาราง */
  textPx: number[][];
  /** padding ซ้าย+ขวา + เส้นขอบของแต่ละคอลัมน์ (px) — ส่วนที่ "ไม่ยืด" ตามขนาดฟอนต์ */
  fixedPx: number[];
  /** ความกว้างพื้นที่พิมพ์ (px) */
  availPx: number;
  refPt: number;
  /** ช่วงที่ยอมให้ auto เลือก */
  minPt: number;
  maxPt: number;
  capShare?: number;
  /** ขนาดที่ผู้ใช้กด −/+ เลือกเอง — ข้ามการคิดอัตโนมัติ (ความกว้าง/การบีบยังคิดให้ตามปกติ) */
  forcedPt?: number | null;
};

export type FitResult = {
  /** ขนาดฟอนต์ที่จะใช้จริง (pt, ทศนิยม 1 ตำแหน่ง) */
  fontPt: number;
  /** ขนาดที่ auto คำนวณได้ — ไว้โชว์ตอนผู้ใช้ปรับเอง */
  autoPt: number;
  /** ความกว้างคอลัมน์เป็น % รวมกันได้ 100 พอดี */
  widthPct: number[];
  /** ตัวคูณแนวนอนของแต่ละช่อง (1 = ไม่บีบ) · scaleX[0] = หัวตาราง เรียงตรงกับ textPx */
  scaleX: number[][];
  /** จำนวนช่องที่ต้องบีบ — เอาไปบอกผู้ใช้ได้ว่ามีกี่ช่องที่โดนบีบให้พอดี */
  squeezed: number;
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * คืน null = วัดยังไม่ได้ (ให้คนเรียกคงผลรอบก่อนไว้ ดีกว่าล้างทิ้งแล้วกระพริบ)
 */
export function fitTable(input: FitInput): FitResult | null {
  const { textPx, fixedPx, availPx, refPt, minPt, maxPt, forcedPt } = input;
  const capShare = input.capShare ?? DEFAULT_CAP_SHARE;
  const nCols = fixedPx.length;

  if (nCols === 0 || textPx.length === 0 || availPx <= 0 || refPt <= 0) return null;
  if (textPx.some((row) => row.length !== nCols)) return null;

  /** พื้นที่ที่เหลือให้ "ตัวหนังสือ" จริง ๆ หลังหัก padding + เส้นขอบของทุกคอลัมน์ */
  const fixedTotal = fixedPx.reduce((a, b) => a + b, 0);
  const inner = availPx - fixedTotal;
  if (inner <= 0) return null;

  /* ---------- 1) ความกว้างข้อความที่แต่ละคอลัมน์ "อยากได้" (หน่วยเป็น px ที่ refPt) ---------- */
  const want = new Array<number>(nCols);
  for (let i = 0; i < nCols; i++) {
    let dataMax = 0;
    for (let r = 1; r < textPx.length; r++) {
      if (textPx[r][i] > dataMax) dataMax = textPx[r][i];
    }
    const head = textPx[0][i];
    /* ไม่มีแถวข้อมูลเลย → ยึดหัวตาราง
       มีข้อมูล → ที่ที่เผื่อให้หัวตาราง = ระหว่าง "บีบได้มากสุด" กับ "เต็มความกว้างหัว"
                  โดยพยายามไม่เกิน HEADER_CAP เท่าของข้อมูลที่ยาวที่สุด */
    const headWant = clamp(dataMax * HEADER_CAP, head * HEADER_MIN_SCALE, head);
    want[i] = dataMax > 0 ? Math.max(dataMax, headWant) : head;
    // 🚨 ห้ามเป็น 0 — คอลัมน์กว้าง 0 แล้วเส้นตารางจะทับกันจนอ่านไม่ออก
    want[i] = Math.max(want[i], 1);
  }

  /* ---------- 2) เพดานต่อคอลัมน์ — รอบเดียว เทียบกับผลรวมก่อนตัด (ไม่งั้นตัดแล้วเพดานลดตาม วนไปเรื่อย ๆ) ---------- */
  const rawTotal = want.reduce((a, b) => a + b, 0);
  const cap = capShare * rawTotal;
  for (let i = 0; i < nCols; i++) want[i] = Math.min(want[i], cap);

  /* ---------- 3) ขนาดฟอนต์ ---------- */
  const wantTotal = want.reduce((a, b) => a + b, 0);
  // 🚨 ปัด "ลง" ไม่ใช่ปัดใกล้สุด — ปัดขึ้นแม้แค่ 0.05pt ก็ทำให้ช่องที่กว้างที่สุดของทุกคอลัมน์
  //    ล้นทีละเศษ แล้วโดนบีบทั้งตารางโดยไม่จำเป็น
  const autoPt =
    Math.floor(clamp((inner / wantTotal) * refPt, minPt, maxPt) * 10) / 10;
  const fontPt =
    forcedPt == null
      ? autoPt
      : Math.round(clamp(forcedPt, FORCED_MIN_PT, FORCED_MAX_PT) * 10) / 10;

  /* ---------- 4) ความกว้างคอลัมน์ที่ขนาดฟอนต์นั้นจริง ๆ ----------
     ตัวหนังสือยืดตามขนาดฟอนต์แบบเชิงเส้น ส่วน padding/เส้นขอบไม่ยืด จึงคิดแยกกัน
     adj เก็บกวาดกรณีฟอนต์ชนเพดาน (adj > 1 = เหลือที่ เกลี่ยคืนให้ทุกคอลัมน์)
     หรือชนพื้น (adj < 1 = ที่ไม่พอ คอลัมน์แคบลงพร้อมกันแล้วไปบีบช่องที่ล้นในข้อ 5) */
  const k = fontPt / refPt;
  const adj = inner / (wantTotal * k);
  const textW = want.map((w) => w * k * adj);

  const widthPct = textW.map((w, i) => ((w + fixedPx[i]) / availPx) * 100);

  /* ---------- 5) ช่องที่ยังล้น → บีบเฉพาะช่องนั้นให้แคบลง (ยังอยู่บรรทัดเดียว ไม่ตัดข้อความทิ้ง) ---------- */
  let squeezed = 0;
  const scaleX = textPx.map((row) =>
    row.map((wpx, i) => {
      const need = wpx * k;
      // เผื่อครึ่ง px ให้เศษการปัดของเบราว์เซอร์ — ไม่งั้นได้ scaleX 0.998 เต็มตารางแบบไร้ประโยชน์
      if (need <= textW[i] + 0.5 || need <= 0) return 1;
      squeezed++;
      // ปัดเป็นทศนิยม 3 ตำแหน่ง — ลายเซ็นจะได้นิ่ง ไม่กระพริบเพราะเศษ float
      return Math.max(0.05, Math.floor((textW[i] / need) * 1000) / 1000);
    }),
  );

  return { fontPt, autoPt, widthPct, scaleX, squeezed };
}
