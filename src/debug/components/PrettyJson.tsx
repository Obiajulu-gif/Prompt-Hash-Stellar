export const PrettyJson = ({ json }: { json: unknown }) => {
  return (
    <pre style={{ color: "#ccc", fontSize: "12px" }}>
      {JSON.stringify(json, null, 2)}
    </pre>
  );
};