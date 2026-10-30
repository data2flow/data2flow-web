import { describe, expect, it } from "vitest";
import { EMPTY_FORM, formOf, parseEmails, scheduleBody, serverFieldError, validateScheduleForm, type ReportSchedule } from "../schedules";

const form = (extra: Partial<typeof EMPTY_FORM> = {}) => ({ ...EMPTY_FORM, name: "월간", spaceIds: ["31"], userIds: ["7"], ...extra });

describe("정기 발행 폼(UI-CMP-09, TC-CMP-059)", () => {
  it("실행일 1~28, HH:mm, 수신자 최소 1명, 이메일 형식", () => {
    expect(validateScheduleForm(form())).toEqual({});
    expect(validateScheduleForm(form({ dayOfPeriod: "32" })).dayOfPeriod).toBe("dayRange");
    expect(validateScheduleForm(form({ dayOfPeriod: "0" })).dayOfPeriod).toBe("dayRange");
    expect(validateScheduleForm(form({ publishTime: "9:00" })).publishTime).toBe("timeFormat");
    expect(validateScheduleForm(form({ userIds: [] })).recipients).toBe("recipientsRequired");
    expect(validateScheduleForm(form({ emails: "a@b.co, not-an-email" })).recipients).toBe("emailInvalid");
    expect(validateScheduleForm(form({ spaceIds: [], name: " " }))).toMatchObject({ spaceIds: "spaceRequired", name: "nameRequired" });
    expect(validateScheduleForm(form({ userIds: Array.from({ length: 50 }, (_, i) => String(i)), emails: "a@b.co" })).recipients).toBe("tooManyRecipients");
  });

  it("이메일은 쉼표·줄바꿈으로 나누고 소문자로, 본문에는 version을 싣는다", () => {
    expect(parseEmails("A@B.co;\nc@d.io, a@b.co")).toEqual(["a@b.co", "c@d.io"]);
    expect(scheduleBody(form({ emails: "X@Y.kr", title: "  " }), 3)).toMatchObject({
      dayOfPeriod: 1,
      reportTemplate: { type: "KR_SELF_CHECK", title: null, spaceIds: ["31"], facilityType: null },
      recipients: { userIds: ["7"], emails: ["x@y.kr"] },
      version: 3,
    });
    expect(scheduleBody(form())).not.toHaveProperty("version");
  });

  it("응답을 폼으로, 서버 필드 오류를 폼 필드로", () => {
    const s = { name: "분기", reportTemplate: { type: "KR_SELF_CHECK", spaceIds: ["31"] }, cadence: "QUARTERLY", dayOfPeriod: 5, publishTime: "08:30", periodRule: "PREVIOUS_QUARTER", recipients: { userIds: [], emails: ["a@b.co", "c@d.io"] }, format: "PDF_CSV", enabled: false } as unknown as ReportSchedule;
    expect(formOf(s)).toMatchObject({ dayOfPeriod: "5", emails: "a@b.co, c@d.io", enabled: false, title: "", facilityType: "" });
    expect(serverFieldError("recipients.emails", "Email")).toEqual(["recipients", "emailInvalid"]);
    expect(serverFieldError("recipients.userIds", "NotFound")).toEqual(["recipients", "userNotFound"]);
    expect(serverFieldError("dayOfPeriod", "Range")).toEqual(["dayOfPeriod", "dayRange"]);
  });
});
