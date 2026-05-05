import { Trans } from "@lingui/react/macro"
import { Card } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"

export default function AboutPage() {
	return (
		<div>
			<div>
				<h3 className="text-xl font-medium mb-2">
					<Trans>About</Trans>
				</h3>
				<p className="text-sm text-muted-foreground leading-relaxed">
					<Trans>About Bantay.</Trans>
				</p>
			</div>
			<Separator className="my-4" />

			<div className="space-y-5">
				<Card className="p-5">
					<div className="flex items-baseline justify-between gap-3 flex-wrap">
						<div>
							<h4 className="text-2xl font-semibold tracking-tight">Bantay</h4>
							<p className="text-sm text-muted-foreground mt-1">
								<Trans>Lightweight monitoring for your fleet.</Trans>
							</p>
						</div>
						<span className="text-sm text-muted-foreground tabular-nums">
							v{globalThis.BANTAY?.HUB_VERSION ?? ""}
						</span>
					</div>
				</Card>

				<div>
					<h4 className="text-base font-medium mb-2">
						<Trans>Original author</Trans>
					</h4>
					<p className="text-sm text-muted-foreground leading-relaxed">
						<Trans>
							Bantay is a fork of <strong>Beszel</strong>, originally created by henrygd. All credit for the
							underlying monitoring platform belongs to the upstream project.
						</Trans>
						<br />
						<a
							href="https://github.com/henrygd/beszel"
							target="_blank"
							rel="noopener"
							className="link"
						>
							github.com/henrygd/beszel
						</a>
					</p>
				</div>

				<div>
					<h4 className="text-base font-medium mb-2">
						<Trans>Modified by</Trans>
					</h4>
					<p className="text-sm text-muted-foreground leading-relaxed">
						Richard R. Ayuyang, PhD —{" "}
						<a
							href="https://chadlinuxtech.net"
							target="_blank"
							rel="noopener"
							className="link"
						>
							https://chadlinuxtech.net
						</a>
					</p>
				</div>

				<div>
					<h4 className="text-base font-medium mb-2">
						<Trans>License</Trans>
					</h4>
					<p className="text-sm text-muted-foreground leading-relaxed">
						<Trans>
							Released under the MIT License (inherited from upstream Beszel). See the LICENSE file in the
							source distribution for the full text and original copyright notices.
						</Trans>
					</p>
				</div>
			</div>
		</div>
	)
}
