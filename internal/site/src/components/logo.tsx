export function Logo({ className, iconOnly }: { className?: string; iconOnly?: boolean }) {
	if (iconOnly) {
		return (
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.6"
				strokeLinecap="round"
				strokeLinejoin="round"
				className={className}
				role="img"
				aria-label="Bantay"
			>
				<rect x="2.5" y="3.5" width="19" height="6.5" rx="1" />
				<line x1="5" y1="6.75" x2="13" y2="6.75" />
				<circle cx="18" cy="6.75" r="0.85" fill="currentColor" />
				<rect x="2.5" y="14" width="19" height="6.5" rx="1" />
				<line x1="5" y1="17.25" x2="13" y2="17.25" />
				<circle cx="18" cy="17.25" r="0.85" fill="currentColor" />
			</svg>
		)
	}
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 230 60"
			fill="none"
			stroke="currentColor"
			strokeWidth="3.5"
			strokeLinecap="round"
			strokeLinejoin="round"
			className={className}
			role="img"
			aria-label="Bantay"
		>
			<g transform="translate(2 6)">
				<rect x="0" y="0" width="48" height="18" rx="2.5" />
				<line x1="6" y1="9" x2="26" y2="9" />
				<circle cx="38" cy="9" r="2.2" fill="currentColor" stroke="none" />
				<rect x="0" y="26" width="48" height="18" rx="2.5" />
				<line x1="6" y1="35" x2="26" y2="35" />
				<circle cx="38" cy="35" r="2.2" fill="currentColor" stroke="none" />
			</g>
			<text
				x="62"
				y="44"
				fontFamily="ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
				fontSize="40"
				fontWeight="800"
				letterSpacing="-1"
				fill="currentColor"
				stroke="none"
			>
				Bantay
			</text>
		</svg>
	)
}
