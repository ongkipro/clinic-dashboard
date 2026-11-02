// Fixture: "use server" inside a function is not a module-level directive.
export async function inline() {
  "use server";
}
