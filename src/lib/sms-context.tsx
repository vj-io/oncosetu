"use client";

import { createContext, useContext } from "react";

/**
 * Whether text messages can reach anyone (a provider is configured, or the demo's simulated phone), and whether this is the
 * demo. Set by the staff layout. Without SMS, screens offer only in-person witnessed confirmation and hide send-a-code steps
 * whose code would never arrive. Default `sms: true` keeps screens rendered outside the staff layout unchanged.
 */
export const SmsContext = createContext<{ sms: boolean; demo: boolean }>({ sms: true, demo: false });
export const useSms = () => useContext(SmsContext);
