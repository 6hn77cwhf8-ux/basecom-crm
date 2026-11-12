/** Erro com o código HTTP e a mensagem a mostrar ao utilizador (em português). */
export class AuthError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
