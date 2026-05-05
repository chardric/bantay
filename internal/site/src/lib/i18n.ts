import { i18n } from "@lingui/core"
import { t } from "@lingui/core/macro"
import { messages as enMessages } from "@/locales/en/en"
import { BatteryState } from "./enums"
import { $direction } from "./stores"

// English-only build: locale picker is removed and getLocale() always returns "en".
// dynamicActivate is kept as a no-op so existing call sites remain valid.

export async function dynamicActivate(_locale: string) {
	i18n.load("en", enMessages)
	i18n.activate("en")
	document.documentElement.lang = "en"
	$direction.set("ltr")
}

export function getLocale() {
	return "en"
}

////////////////////////////////////////////////////////

export const batteryStateTranslations = {
	[BatteryState.Unknown]: () => t({ message: "Unknown", comment: "Context: Battery state" }),
	[BatteryState.Empty]: () => t({ message: "Empty", comment: "Context: Battery state" }),
	[BatteryState.Full]: () => t({ message: "Full", comment: "Context: Battery state" }),
	[BatteryState.Charging]: () => t({ message: "Charging", comment: "Context: Battery state" }),
	[BatteryState.Discharging]: () => t({ message: "Discharging", comment: "Context: Battery state" }),
	[BatteryState.Idle]: () => t({ message: "Idle", comment: "Context: Battery state" }),
} as const
