export function Feedback({ message, error }: { message?: string; error?: string }) {
  return (
    <>
      {message && <p role="status">{message}</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </>
  );
}
