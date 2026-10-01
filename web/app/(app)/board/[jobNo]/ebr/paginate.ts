/**
 * จัดหน้า eBR เป็นแผ่น A4 ตายตัว (.ebr-pg) ก่อนสร้าง PDF — ⚠️ client เท่านั้น
 *
 * ทำไมต้องจัดหน้าเอง: sheetsToPdf() จับภาพ "ทีละแผ่น" แต่ eBR บนจอเป็นเอกสารยาวต่อเนื่อง
 * ที่ปล่อยให้เบราว์เซอร์ตัดหน้าเองตอน window.print() → ต้องแบ่งเป็นแผ่นเองก่อน
 *
 * วิธี: คัดลอกเนื้อหาจาก #ebr ทีละชิ้นลงแผ่น แล้ววัดว่าล้นพื้นที่เนื้อหาไหม (ล้น = ขึ้นแผ่นใหม่)
 *   · ตาราง .ebr-t ตัดได้ทีละแถว + หัวตารางซ้ำทุกแผ่น (แถวไม่ถูกตัดครึ่ง)
 *   · ชิ้นอื่น (กรอบข้อมูล · การ์ด Incident · ช่องลงนาม ฯลฯ) ไม่ตัด
 *   · หัวข้อ (.ebr-h2) ไม่ค้างท้ายแผ่นลำพัง — ถ้าเนื้อหาชิ้นแรกไม่พอ ยกหัวข้อไปด้วย
 *   · หัว/ท้ายกระดาษซ้ำทุกแผ่น + เลขหน้า "หน้า X / Y"
 * ของที่สร้างอยู่ใน container นอกจอ — เรียก cleanup() หลังสร้าง PDF เสร็จ
 */
export function paginateEbr(): { sheets: HTMLElement[]; cleanup: () => void } {
  const src = document.getElementById("ebr");
  const content = src?.querySelector<HTMLElement>(".ebr-frame > tbody > tr > td");
  const head = src?.querySelector<HTMLElement>(".ebr-run-head > div");
  const foot = src?.querySelector<HTMLElement>(".ebr-run-foot > div");
  if (!src || !content || !head || !foot) throw new Error("ไม่พบเนื้อหาแฟ้มบันทึกการผลิต");

  const host = document.createElement("div");
  host.className = "ebr-paged no-print";
  (src.closest(".ebr-page") ?? document.body).appendChild(host);

  const sheets: HTMLElement[] = [];
  let body!: HTMLElement;
  /** ที่ที่ชิ้นถัดไปจะถูกวาง — body ของแผ่น หรือกล่อง section ในแผ่นนั้น */
  let parent!: HTMLElement;
  /** section ต้นฉบับที่กำลังวางอยู่ (null = อยู่นอก section) */
  let section: HTMLElement | null = null;

  const fits = () => body.scrollHeight <= body.clientHeight + 1;

  function newSheet() {
    const sheet = document.createElement("div");
    sheet.className = "ebr-pg";
    const h = head!.cloneNode(true) as HTMLElement;
    h.className = "ebr-pg-head";
    body = document.createElement("div");
    body.className = "ebr-pg-body";
    const f = foot!.cloneNode(true) as HTMLElement;
    f.className = "ebr-pg-foot";
    sheet.append(h, body, f);
    host.appendChild(sheet);
    sheets.push(sheet);
    parent = body;
    if (section) openSection();
  }

  /** กล่อง section ใหม่บนแผ่นปัจจุบัน (ต่อจากแผ่นก่อน = ไม่มีหัวข้อซ้ำ) */
  function openSection() {
    const box = section!.cloneNode(false) as HTMLElement;
    if (body.childElementCount === 0) box.style.marginTop = "0";
    body.appendChild(box);
    parent = box;
  }

  /** ล้นแล้ว → ขึ้นแผ่นใหม่ · ถ้ากล่อง section บนแผ่นนี้มีแค่หัวข้อ ยกหัวข้อไปแผ่นใหม่ด้วย */
  function breakSheet() {
    const lonely =
      section &&
      parent !== body &&
      parent.childElementCount === 1 &&
      parent.firstElementChild?.classList.contains("ebr-h2") &&
      body.childElementCount > 1; // ถ้าอยู่บนสุดของแผ่นอยู่แล้ว ยกไปก็ไม่ช่วย
    if (lonely) {
      const box = parent;
      box.remove();
      const keepSection = section;
      section = null;
      newSheet();
      section = keepSection;
      box.style.marginTop = "0";
      body.appendChild(box);
      parent = box;
    } else {
      newSheet();
    }
  }

  function placeAtom(el: Element) {
    const node = el.cloneNode(true) as HTMLElement;
    parent.appendChild(node);
    if (fits()) return;
    node.remove();
    breakSheet();
    parent.appendChild(node); // ชิ้นที่สูงเกินแผ่นเดียว — ยอมวางไว้ (ส่วนเกินถูกตัด) ดีกว่าวนไม่จบ
  }

  function placeTable(tbl: HTMLTableElement) {
    let tbody!: HTMLTableSectionElement;
    let shell!: HTMLTableElement;
    const openShell = () => {
      shell = tbl.cloneNode(false) as HTMLTableElement;
      if (tbl.tHead) shell.appendChild(tbl.tHead.cloneNode(true));
      tbody = document.createElement("tbody");
      shell.appendChild(tbody);
      parent.appendChild(shell);
    };
    openShell();
    for (const row of Array.from(tbl.tBodies[0]?.rows ?? [])) {
      const tr = row.cloneNode(true) as HTMLTableRowElement;
      tbody.appendChild(tr);
      if (fits()) continue;
      tr.remove();
      if (tbody.rows.length === 0) shell.remove(); // หัวตารางเปล่า ๆ ไม่ทิ้งไว้ท้ายแผ่น
      breakSheet();
      openShell();
      tbody.appendChild(tr);
    }
  }

  newSheet();
  for (const child of Array.from(content.children)) {
    if (child.matches("section.ebr-section")) {
      section = child as HTMLElement;
      openSection();
      // div ไม่มี class = กล่องครอบเฉย ๆ (เช่นรายการ Incident) → ไล่ลูกทีละชิ้น ไม่มัดทั้งก้อน
      const items = Array.from(child.children).flatMap((c) =>
        c.tagName === "DIV" && !c.className ? Array.from(c.children) : [c],
      );
      for (const c of items) {
        if (c.matches("table.ebr-t")) placeTable(c as HTMLTableElement);
        else placeAtom(c);
      }
      section = null;
      parent = body;
    } else {
      placeAtom(child);
    }
  }

  // เลขหน้า — ต่อท้ายข้อความฝั่งขวาของท้ายกระดาษ
  sheets.forEach((s, i) => {
    const right = s.querySelector(".ebr-pg-foot > :last-child");
    if (right) right.textContent = `${right.textContent} · หน้า ${i + 1} / ${sheets.length}`;
  });

  return { sheets, cleanup: () => host.remove() };
}
