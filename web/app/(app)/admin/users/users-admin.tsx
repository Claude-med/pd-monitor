"use client";

import { useMemo, useState, useTransition } from "react";
import { ALL_ROLES, ROLE_LABELS } from "@/lib/nav";
import { ROLE_ACCESS, COMMON_VIEW } from "@/lib/data/role-access";
import type { AppRole } from "@/lib/auth/dal";
import type { AdminUser } from "@/lib/data/admin-users";
import {
  DEPT_LABEL,
  assignableRolesForHead,
  headMayManage,
  type UserAdminScope,
} from "@/lib/data/dept-constants";
import {
  createUser,
  setRoles,
  updateProfile,
  resetPassword,
  setActive,
} from "./actions";

const inputClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";
const labelClass = "mb-1 block text-xs font-medium text-muted-foreground";

/**
 * กล่องติ๊กสิทธิ์ — `options` จำกัดว่าเห็น/เลือกได้แค่ไหน
 * (หัวหน้าแผนกเห็นเฉพาะสิทธิ์ของลูกน้องในฝ่ายตัวเอง)
 * ⚠️ นี่เป็นแค่การจัดหน้าจอ — ด่านจริงคือ admin_set_roles() ใน DB (0079)
 */
function RoleChecks({
  value,
  onChange,
  options = ALL_ROLES,
  disabled = false,
}: {
  value: AppRole[];
  onChange: (roles: AppRole[]) => void;
  options?: AppRole[];
  disabled?: boolean;
}) {
  function toggle(r: AppRole) {
    onChange(value.includes(r) ? value.filter((x) => x !== r) : [...value, r]);
  }
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((r) => (
        <label
          key={r}
          className={[
            "cursor-pointer rounded-md border px-2.5 py-1 text-sm",
            value.includes(r)
              ? "border-primary bg-primary/10 font-medium"
              : "hover:bg-accent",
          ].join(" ")}
        >
          <input
            type="checkbox"
            className="mr-1.5 align-middle"
            checked={value.includes(r)}
            disabled={disabled}
            onChange={() => toggle(r)}
          />
          {ROLE_LABELS[r]}
        </label>
      ))}
    </div>
  );
}

/** ตัวกรองรายชื่อ: role ใดๆ · ทั้งหมด · ยังไม่กำหนดสิทธิ์ */
type RoleFilter = AppRole | "all" | "none";

/** แถบสรุป "แต่ละฝ่ายมีกี่บัญชี" — กดชิปเพื่อกรองรายชื่อด้านล่าง */
function RoleCountBar({
  users,
  filter,
  onFilter,
  roleOptions,
  scope,
}: {
  users: AdminUser[];
  filter: RoleFilter;
  onFilter: (f: RoleFilter) => void;
  roleOptions: AppRole[];
  scope: UserAdminScope;
}) {
  const noneCount = users.filter((u) => u.roles.length === 0).length;
  const isHead = scope.kind === "head";
  const heading = isHead
    ? `บัญชีใน${scope.depts.map((d) => DEPT_LABEL[d]).join(" · ")}`
    : "จำนวนบัญชีแต่ละฝ่าย";

  function chipClass(active: boolean) {
    return [
      "rounded-full border px-3 py-1 text-sm transition",
      active
        ? "border-primary bg-primary/10 font-medium"
        : "hover:bg-accent",
    ].join(" ");
  }

  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="mb-2 text-sm font-semibold">{heading}</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onFilter("all")}
          className={chipClass(filter === "all")}
        >
          ทั้งหมด · {users.length}
        </button>
        {roleOptions.map((r) => {
          const n = users.filter((u) => u.roles.includes(r)).length;
          return (
            <button
              key={r}
              type="button"
              onClick={() => onFilter(r)}
              className={chipClass(filter === r)}
            >
              {ROLE_LABELS[r]} ·{" "}
              <span className="tabular-nums font-medium">{n}</span>
            </button>
          );
        })}
        {noneCount > 0 && (
          <button
            type="button"
            onClick={() => onFilter("none")}
            className={[
              chipClass(filter === "none"),
              filter === "none" ? "" : "text-amber-700 dark:text-amber-400",
            ].join(" ")}
          >
            ยังไม่กำหนดสิทธิ์ · {noneCount}
          </button>
        )}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        กดชิปเพื่อกรองรายชื่อด้านล่าง · 1 บัญชีมีได้หลายสิทธิ์ →
        จะถูกนับในทุกฝ่ายที่ได้รับสิทธิ์
        {isHead ? " · แสดงเฉพาะพนักงานในฝ่ายของคุณ" : ""}
      </p>
    </div>
  );
}

/** แผงอธิบาย "แต่ละสิทธิ์เข้าถึงอะไรได้บ้าง" (พับเก็บได้) */
function RoleAccessPanel({ roleOptions }: { roleOptions: AppRole[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-xl border bg-card">
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className="flex w-full items-center justify-between px-5 py-4 text-left"
      >
        <span className="font-semibold">
          📋 แต่ละสิทธิ์ (Role) เข้าถึงอะไรได้บ้าง
        </span>
        <span className="text-sm text-muted-foreground">
          {open ? "ซ่อน" : "เปิด"}
        </span>
      </button>
      {open && (
        <div className="space-y-4 border-t p-5">
          <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            ทุกบัญชีที่ล็อกอินเห็นเหมือนกัน (ดูอย่างเดียว): {COMMON_VIEW}
          </p>

          {/* เดสก์ท็อป = ตาราง */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-2 py-2 font-medium">สิทธิ์ (Role)</th>
                  <th className="px-2 py-2 font-medium">หน้าที่หลัก</th>
                  <th className="px-2 py-2 font-medium">บันทึก / แก้ไขได้</th>
                  <th className="px-2 py-2 font-medium">เห็นเพิ่ม (ดูอย่างเดียว)</th>
                </tr>
              </thead>
              <tbody>
                {roleOptions.map((r) => {
                  const a = ROLE_ACCESS[r];
                  return (
                    <tr key={r} className="border-b align-top last:border-0">
                      <td className="px-2 py-2">
                        <span className="font-medium">{ROLE_LABELS[r]}</span>
                        <span className="ml-1 rounded bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-foreground">
                          {a.code}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-muted-foreground">{a.duty}</td>
                      <td className="px-2 py-2">
                        <ul className="list-inside list-disc space-y-0.5">
                          {a.manage.map((m, i) => (
                            <li key={i}>{m}</li>
                          ))}
                        </ul>
                      </td>
                      <td className="px-2 py-2 text-muted-foreground">
                        {a.view.length > 0 ? (
                          <ul className="list-inside list-disc space-y-0.5">
                            {a.view.map((v, i) => (
                              <li key={i}>{v}</li>
                            ))}
                          </ul>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* มือถือ = การ์ดเรียงลง */}
          <div className="space-y-3 md:hidden">
            {roleOptions.map((r) => {
              const a = ROLE_ACCESS[r];
              return (
                <div key={r} className="rounded-lg border p-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{ROLE_LABELS[r]}</span>
                    <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-foreground">
                      {a.code}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{a.duty}</p>
                  <p className="mt-2 text-xs font-medium">บันทึก / แก้ไขได้</p>
                  <ul className="list-inside list-disc text-sm">
                    {a.manage.map((m, i) => (
                      <li key={i}>{m}</li>
                    ))}
                  </ul>
                  {a.view.length > 0 && (
                    <>
                      <p className="mt-2 text-xs font-medium">
                        เห็นเพิ่ม (ดูอย่างเดียว)
                      </p>
                      <ul className="list-inside list-disc text-sm text-muted-foreground">
                        {a.view.map((v, i) => (
                          <li key={i}>{v}</li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          <p className="text-xs text-muted-foreground">
            * ระบบบังคับสิทธิ์จริงที่ฐานข้อมูล (ทุกการบันทึกผ่านฟังก์ชันที่ตรวจสิทธิ์)
            — ไม่ใช่แค่ซ่อนปุ่มบนหน้าจอ
          </p>
        </div>
      )}
    </div>
  );
}

export function UsersAdmin({
  users,
  currentProfileId,
  scope,
}: {
  users: AdminUser[];
  currentProfileId: string;
  scope: UserAdminScope;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState<RoleFilter>("all");

  /** สิทธิ์ที่ขอบเขตนี้เห็น/แจกได้ — หัวหน้าแผนก = role พื้นของฝ่ายตัวเองเท่านั้น */
  const roleOptions = useMemo(
    () =>
      scope.kind === "manager" ? ALL_ROLES : assignableRolesForHead(scope.depts),
    [scope],
  );

  const shown =
    filter === "all"
      ? users
      : filter === "none"
        ? users.filter((u) => u.roles.length === 0)
        : users.filter((u) => u.roles.includes(filter));

  return (
    <div className="space-y-5">
      {/* ---------- สรุปจำนวนบัญชีต่อฝ่าย + คำอธิบายสิทธิ์ ---------- */}
      <RoleCountBar
        users={users}
        filter={filter}
        onFilter={setFilter}
        roleOptions={roleOptions}
        scope={scope}
      />
      <RoleAccessPanel roleOptions={roleOptions} />

      {/* ---------- สร้างบัญชีใหม่ ---------- */}
      <div className="rounded-xl border bg-card">
        <button
          type="button"
          onClick={() => setShowCreate((s) => !s)}
          className="flex w-full items-center justify-between px-5 py-4 text-left"
        >
          <span className="font-semibold">＋ สร้างบัญชีผู้ใช้ใหม่</span>
          <span className="text-sm text-muted-foreground">
            {showCreate ? "ซ่อน" : "เปิด"}
          </span>
        </button>
        {showCreate && (
          <div className="border-t p-5">
            <CreateForm scope={scope} roleOptions={roleOptions} />
          </div>
        )}
      </div>

      {/* ---------- รายชื่อผู้ใช้ ---------- */}
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {filter === "all" ? (
            <>ผู้ใช้ทั้งหมด {users.length} คน</>
          ) : (
            <>
              แสดง {shown.length} คน
              {filter === "none"
                ? " (ยังไม่กำหนดสิทธิ์)"
                : ` (สิทธิ์ ${ROLE_LABELS[filter]})`}{" "}
              จากทั้งหมด {users.length} คน ·{" "}
              <button
                type="button"
                onClick={() => setFilter("all")}
                className="underline hover:text-foreground"
              >
                ล้างตัวกรอง
              </button>
            </>
          )}
        </p>
        {shown.length === 0 && (
          <p className="rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground">
            ไม่มีบัญชีในกลุ่มนี้
          </p>
        )}
        {shown.map((u) => (
          <UserRow
            key={u.id}
            user={u}
            isSelf={u.id === currentProfileId}
            open={openId === u.id}
            onToggle={() => setOpenId((id) => (id === u.id ? null : u.id))}
            roleOptions={roleOptions}
            /* หัวหน้าแผนกแตะได้เฉพาะลูกน้องในฝ่ายตัวเอง — ด่านจริงอยู่ที่ head_may_manage() ใน DB */
            canManage={
              scope.kind === "manager" ||
              headMayManage(scope.depts, {
                roles: u.roles,
                isSelf: u.id === currentProfileId,
              })
            }
          />
        ))}
      </div>
    </div>
  );
}

function CreateForm({
  scope,
  roleOptions,
}: {
  scope: UserAdminScope;
  roleOptions: AppRole[];
}) {
  // หัวหน้าแผนก: แผนกถูกล็อกเป็นฝ่ายของตัวเอง (ค่ามาตรฐาน ไม่ใช่ช่องพิมพ์อิสระ)
  // ⚠️ server เขียนทับค่านี้ด้วยฝ่ายของหัวหน้าเสมอ — ช่องนี้เป็นแค่การแสดงผล
  const lockedDept =
    scope.kind === "head"
      ? scope.depts.map((d) => DEPT_LABEL[d]).join(" / ")
      : null;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [department, setDepartment] = useState(lockedDept ?? "");
  const [roles, setRolesState] = useState<AppRole[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    setError(null);
    setOkMsg(null);
    start(async () => {
      const res = await createUser({
        email,
        password,
        full_name: fullName,
        department,
        roles,
      });
      if (res.ok) {
        // แสดงผลสำเร็จค้างไว้ในฟอร์ม — เดิมเรียก onDone() ทันทีทำให้ accordion ปิด
        // ก่อนที่ผู้ใช้จะทันเห็นข้อความว่าสร้างบัญชีให้ใครไปแล้ว
        setOkMsg(`สร้างบัญชี ${email} แล้ว — ผู้ใช้ต้องตั้งรหัสผ่านใหม่เองตอนล็อกอินครั้งแรก`);
        setEmail("");
        setPassword("");
        setFullName("");
        setDepartment(lockedDept ?? "");
        setRolesState([]);
        return;
      }
      setError(res.error ?? "สร้างบัญชีไม่สำเร็จ");
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass}>อีเมล (ใช้ล็อกอิน) *</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="เช่น somchai.prod@pdmonitor.app"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>รหัสผ่านเริ่มต้น *</label>
          <input
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="อย่างน้อย 6 ตัวอักษร"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>ชื่อ-สกุล *</label>
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="เช่น สมชาย ใจดี"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>
            แผนก{lockedDept ? " (ล็อกตามฝ่ายของคุณ)" : ""}
          </label>
          <input
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            placeholder="เช่น ฝ่ายผลิต"
            readOnly={lockedDept !== null}
            className={[
              inputClass,
              lockedDept !== null ? "bg-muted text-muted-foreground" : "",
            ].join(" ")}
          />
        </div>
      </div>
      <div>
        <label className={labelClass}>
          สิทธิ์ (เลือกได้หลายอย่าง)
          {scope.kind === "head" ? " — เฉพาะสิทธิ์ของพนักงานในฝ่ายคุณ" : ""}
        </label>
        <RoleChecks
          value={roles}
          onChange={setRolesState}
          options={roleOptions}
        />
      </div>

      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {okMsg && (
        <p className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
          {okMsg}
        </p>
      )}

      <button
        type="button"
        disabled={pending}
        onClick={submit}
        className="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "กำลังสร้าง…" : "สร้างบัญชี"}
      </button>
      <p className="text-xs text-muted-foreground">
        บัญชีถูกยืนยันอีเมลให้อัตโนมัติ — ผู้ใช้ล็อกอินด้วยอีเมล + รหัสผ่านนี้ได้ทันที
        และ <span className="font-medium">ระบบจะบังคับให้ตั้งรหัสผ่านใหม่เองก่อนใช้งาน</span>{" "}
        (คนสร้างบัญชีรู้รหัสเริ่มต้น จึงต้องไม่ใช้รหัสนั้นทำงานแทนกัน)
      </p>
    </div>
  );
}

function UserRow({
  user,
  isSelf,
  open,
  onToggle,
  roleOptions,
  canManage,
}: {
  user: AdminUser;
  isSelf: boolean;
  open: boolean;
  onToggle: () => void;
  roleOptions: AppRole[];
  canManage: boolean;
}) {
  return (
    <div className="rounded-xl border bg-card">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{user.full_name}</span>
            {isSelf && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                คุณ
              </span>
            )}
            {!user.is_active && (
              <span className="rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] text-destructive">
                ระงับ
              </span>
            )}
            {!user.auth_user_id && (
              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-400">
                ยังไม่มีบัญชีล็อกอิน
              </span>
            )}
            {user.must_change_password && user.auth_user_id && (
              <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] text-sky-700 dark:text-sky-400">
                รอผู้ใช้ตั้งรหัสผ่านเอง
              </span>
            )}
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {user.email ?? "—"}
            {user.department ? ` · ${user.department}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
          {user.roles.length === 0 ? (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              ยังไม่กำหนดสิทธิ์
            </span>
          ) : (
            user.roles.map((r) => (
              <span
                key={r}
                className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-foreground"
              >
                {ROLE_LABELS[r]}
              </span>
            ))
          )}
        </div>
      </button>
      {open && (
        <div className="border-t p-5">
          <UserEditPanel
            user={user}
            isSelf={isSelf}
            roleOptions={roleOptions}
            canManage={canManage}
          />
        </div>
      )}
    </div>
  );
}

function UserEditPanel({
  user,
  isSelf,
  roleOptions,
  canManage,
}: {
  user: AdminUser;
  isSelf: boolean;
  roleOptions: AppRole[];
  canManage: boolean;
}) {
  const [fullName, setFullName] = useState(user.full_name);
  const [department, setDepartment] = useState(user.department ?? "");
  const [roles, setRolesState] = useState<AppRole[]>(user.roles);
  const [newPw, setNewPw] = useState("");
  const [msg, setMsg] = useState<{ ok?: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  function run(fn: () => Promise<{ ok?: boolean; error?: string }>, okText: string) {
    setMsg(null);
    start(async () => {
      const res = await fn();
      setMsg(res.ok ? { ok: true, text: okText } : { text: res.error ?? "ไม่สำเร็จ" });
    });
  }

  // หัวหน้าแผนกเปิดดูบัญชีที่อยู่นอกขอบเขตได้ แต่แก้ไม่ได้ — บอกเหตุผลแทนการซ่อนเงียบ ๆ
  if (!canManage) {
    return (
      <p className="rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
        🔒 บัญชีนี้อยู่นอกขอบเขตของคุณ — หัวหน้าแผนกดูแลได้เฉพาะพนักงานในฝ่ายตัวเอง
        (บัญชีผู้บริหาร ผู้ดูแลระบบ และหัวหน้าฝ่ายอื่น ต้องให้ผู้บริหารจัดการ)
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {/* ข้อมูลโปรไฟล์ */}
      <div className="space-y-3">
        <p className="text-sm font-semibold">ข้อมูลผู้ใช้</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass}>ชื่อ-สกุล</label>
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>แผนก</label>
            <input
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            run(
              () => updateProfile(user.id, fullName, department),
              "บันทึกข้อมูลแล้ว",
            )
          }
          className="rounded-md border px-4 py-2 text-sm hover:bg-accent disabled:opacity-50"
        >
          บันทึกข้อมูล
        </button>
      </div>

      {/* สิทธิ์ */}
      <div className="space-y-3 border-t pt-4">
        <p className="text-sm font-semibold">สิทธิ์ (role)</p>
        <RoleChecks
          value={roles}
          onChange={setRolesState}
          options={roleOptions}
        />
        {isSelf && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            ⚠️ ต้องคงสิทธิ์ผู้บริหารหรือผู้ดูแลระบบของบัญชีตัวเองไว้ (กันล็อกตัวเองออกจากระบบ)
          </p>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => setRoles(user.id, roles), "บันทึกสิทธิ์แล้ว")}
          className="rounded-md border px-4 py-2 text-sm hover:bg-accent disabled:opacity-50"
        >
          บันทึกสิทธิ์
        </button>
      </div>

      {/* รหัสผ่าน */}
      <div className="space-y-3 border-t pt-4">
        <p className="text-sm font-semibold">รีเซ็ตรหัสผ่าน</p>
        {user.auth_user_id ? (
          <>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                type="text"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                placeholder="รหัสผ่านใหม่ (อย่างน้อย 6 ตัว)"
                className={inputClass}
              />
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  run(async () => {
                    const res = await resetPassword(
                      user.id,
                      user.auth_user_id!,
                      newPw,
                    );
                    if (res.ok) setNewPw("");
                    return res;
                  }, "ตั้งรหัสผ่านใหม่แล้ว")
                }
                className="shrink-0 rounded-md border px-4 py-2 text-sm hover:bg-accent disabled:opacity-50"
              >
                ตั้งรหัสใหม่
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              ระบบเก็บรหัสแบบเข้ารหัส — ตั้งใหม่ได้ แต่ดูรหัสเดิมไม่ได้ ·
              ผู้ใช้จะถูกบังคับให้ตั้งรหัสของตัวเองอีกครั้งตอนล็อกอินถัดไป
            </p>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            ผู้ใช้นี้ยังไม่มีบัญชีล็อกอิน (มาจากข้อมูลตั้งต้น) — รีเซ็ตรหัสไม่ได้
            จนกว่าจะสร้างบัญชีด้วยอีเมลนี้
          </p>
        )}
      </div>

      {/* เปิด/ระงับบัญชี */}
      <div className="space-y-2 border-t pt-4">
        <p className="text-sm font-semibold">สถานะบัญชี</p>
        <button
          type="button"
          disabled={pending || isSelf}
          onClick={() =>
            run(
              () => setActive(user.id, user.auth_user_id, !user.is_active),
              user.is_active ? "ระงับบัญชีแล้ว" : "เปิดใช้งานบัญชีแล้ว",
            )
          }
          className={[
            "rounded-md border px-4 py-2 text-sm disabled:opacity-50",
            user.is_active
              ? "border-destructive/40 text-destructive hover:bg-destructive/10"
              : "hover:bg-accent",
          ].join(" ")}
        >
          {user.is_active ? "ระงับบัญชี (บล็อกล็อกอิน)" : "เปิดใช้งานบัญชี"}
        </button>
        {isSelf && (
          <p className="text-xs text-muted-foreground">ระงับบัญชีตัวเองไม่ได้</p>
        )}
      </div>

      {msg && (
        <p
          className={[
            "rounded-md px-3 py-2 text-sm",
            msg.ok
              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
              : "bg-destructive/10 text-destructive",
          ].join(" ")}
        >
          {msg.text}
        </p>
      )}
    </div>
  );
}
