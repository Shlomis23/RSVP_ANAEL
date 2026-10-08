export const invitation = {
  slug: "anael",
  title: "חוגגים את אנאל",
  babyName: "אנאל",
  hosts: "עדי ועדן תמיר",
  date: "18.10.2026",
  day: "יום ראשון",
  hebrewDate: "ז׳ בחשוון התשפ״ז",
  time: "19:30",
  venue: "אולם אצולת העמק",
  city: "עפולה",
  text: "בשבח והודיה לבורא עולם, אנו שמחים להזמינכם לחגוג איתנו את שמחת הולדת ביתנו",
};
export type Attendance = "yes" | "no" | "maybe";
export const attendanceLabels: Record<Attendance, string> = {
  yes: "מגיעים",
  no: "לא מגיעים",
  maybe: "מתלבטים",
};
export type Rsvp = {
  id: string;
  full_name: string;
  attendance: Attendance;
  guest_count: number;
  version: number;
  source: "guest" | "admin";
  created_at: string;
  updated_at: string;
};
