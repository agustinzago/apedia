"use server";

import { redirect } from "next/navigation";
import { salesPausedNote } from "@/app/daily-limit";
import { safeNext } from "@/auth";
import { auth } from "@/server/auth";
import { getCourse } from "@/server/course";
import { requestOrigin } from "@/server/jobs";
import { getPayments } from "@/server/payments";

export type BuyState = { error: string | null };

/**
 * "Buy a Course": sends the signed-in Learner to the provider's checkout,
 * with their id attached, and back to the thanks page after paying. Only
 * the provider's webhook grants the Course credit. A visitor signs in first
 * and comes back to the page they were on (`from`).
 */
export async function buyCourse(_previous: BuyState, form: FormData): Promise<BuyState> {
  const from = safeNext(form.get("from"));
  const session = await auth();
  const learnerId = session?.user?.id;
  const email = session?.user?.email;
  if (!learnerId || !email) redirect(`/sign-in?${new URLSearchParams({ next: from })}`);

  const course = await getCourse();
  const paused = await course.readSalesPause();
  if (paused) return { error: salesPausedNote(paused.resumesAt) };

  const origin = await requestOrigin();
  let checkoutUrl: string;
  try {
    const checkout = await getPayments().startCheckout({
      learnerId,
      email,
      successUrl: `${origin}/purchase/thanks`,
      returnUrl: `${origin}${from}`,
    });
    if (!checkout.ok) {
      return { error: "Buying a Course isn’t set up yet on this copy of Apedia." };
    }
    checkoutUrl = checkout.url;
  } catch (error) {
    console.error("Could not start a checkout.", error);
    return { error: "The checkout couldn’t open just now. Please try again in a moment." };
  }
  redirect(checkoutUrl);
}
