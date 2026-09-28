import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_DAILY_LIMITS, DEFAULT_SPEND_LIMITS } from "@/course";
import { dailyLimitsFromEnv, spendAlarmFromEnv, spendLimitsFromEnv } from "./config";

const alert = { day: "2026-09-28", spentUsd: 21.5, thresholdUsd: 20, stopUsd: 40 };

describe("server: cost protection from the environment", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads the daily limits, falling back to the spec's for unset or broken values", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(dailyLimitsFromEnv({})).toEqual(DEFAULT_DAILY_LIMITS);
    expect(
      dailyLimitsFromEnv({
        APEDIA_DAILY_NEW_COURSES: "2",
        APEDIA_DAILY_LESSONS: "lots",
        APEDIA_DAILY_CHAT_MESSAGES: "0",
      }),
    ).toEqual({ newCourses: 2, lessonGenerations: 10, chatMessages: 0 });
  });

  it("reads the spend limits, stopping at twice the alarm unless told otherwise", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(spendLimitsFromEnv({})).toEqual(DEFAULT_SPEND_LIMITS);
    expect(DEFAULT_SPEND_LIMITS).toEqual({ alarmUsd: 20, stopUsd: 40 });
    expect(spendLimitsFromEnv({ APEDIA_SPEND_ALARM_USD: "30" })).toEqual({
      alarmUsd: 30,
      stopUsd: 60,
    });
    expect(
      spendLimitsFromEnv({ APEDIA_SPEND_ALARM_USD: "30", APEDIA_SPEND_STOP_USD: "35" }),
    ).toEqual({ alarmUsd: 30, stopUsd: 35 });
    expect(spendLimitsFromEnv({ APEDIA_SPEND_STOP_USD: "none" })).toEqual(DEFAULT_SPEND_LIMITS);
    expect(warn).toHaveBeenCalledTimes(1);

    // A stop below the alarm would stop the Teacher before sales pause.
    expect(
      spendLimitsFromEnv({ APEDIA_SPEND_ALARM_USD: "30", APEDIA_SPEND_STOP_USD: "10" }),
    ).toEqual({ alarmUsd: 30, stopUsd: 30 });
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("emails the operator through Resend in production", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 200 }));
    const alarm = spendAlarmFromEnv(
      {
        NODE_ENV: "production",
        APEDIA_OPERATOR_EMAIL: "operator@example.com",
        AUTH_RESEND_KEY: "re_123",
        AUTH_EMAIL_FROM: "Apedia <alerts@example.com>",
      },
      { send },
    );

    await alarm.notify(alert);

    const [url, init] = send.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer re_123" });
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      from: "Apedia <alerts@example.com>",
      to: ["operator@example.com"],
      subject: "Apedia spend passed $20.00 on 2026-09-28",
    });
    expect(body.text).toContain("$21.50");
    expect(body.text).toContain("New Interviews are paused until midnight UTC");
    expect(body.text).toContain("$40.00");
  });

  it("fails the alert when Resend refuses it, so it is tried again", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response("bad key", { status: 401 }));
    const alarm = spendAlarmFromEnv(
      {
        NODE_ENV: "production",
        APEDIA_OPERATOR_EMAIL: "operator@example.com",
        AUTH_RESEND_KEY: "re_bad",
      },
      { send },
    );

    await expect(alarm.notify(alert)).rejects.toThrow("Resend answered 401");
  });

  it("logs the alert outside production, or without an operator email", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const send = vi.fn<typeof fetch>();
    const log = vi.fn();

    const local = spendAlarmFromEnv(
      { AUTH_RESEND_KEY: "re_123", APEDIA_OPERATOR_EMAIL: "ops@example.com" },
      { send, log },
    );
    await local.notify(alert);
    const noEmail = spendAlarmFromEnv(
      { NODE_ENV: "production", AUTH_RESEND_KEY: "re_123" },
      { send, log },
    );
    await noEmail.notify(alert);

    expect(send).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[0][0]).toContain("Apedia spend passed $20.00");
  });
});
