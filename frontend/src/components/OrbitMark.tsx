const OrbitMark = ({ size = 26 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 26 26" fill="none" aria-hidden="true">
    <circle cx="13" cy="13" r="10.5" stroke="#0F766E" strokeWidth="1.25" />
    <circle cx="13" cy="13" r="6" stroke="#0F766E" strokeWidth="1" opacity="0.55" />
    <circle cx="13" cy="2.5" r="1.75" fill="#0F766E" />
  </svg>
);

export default OrbitMark;
