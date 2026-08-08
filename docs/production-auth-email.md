# Production authentication email runbook

## Incident: `email rate limit exceeded`

This response comes from **Supabase Auth**, not the Render/FastAPI service.
The registration page calls `supabase.auth.signUp()` directly in the browser;
each unconfirmed email/password registration asks Supabase to send a
confirmation email. Password resets use the same delivery quota.

Supabase's built-in mailer is a development service and has a project-wide
limit of two emails per hour. It is therefore not suitable for NextUp's
production sign-ups. The limit is shared by sign-up, password reset, and email
change messages, so a few requests can block all students.

## Required production change

1. Create and verify a sending domain, e.g. `auth.your-domain.example`, with a
   transactional SMTP provider (Resend, AWS SES, Postmark, Brevo, etc.). Publish
   the provider's SPF/DKIM DNS records before sending production traffic.
2. In the correct Supabase project, open **Authentication → Emails → SMTP
   Settings** and enable Custom SMTP. Enter the provider host, port, username,
   password, sender name, and a verified `no-reply@...` From address.
3. Open **Authentication → Rate Limits** and set the email-sent limit to a
   value that covers the expected peak, including sign-ups, password resets,
   and retries. Supabase starts custom SMTP projects at 30 emails/hour; this is
   still too low for a launch surge unless it is raised.
4. In **Authentication → URL Configuration**, set the Site URL to
   `https://project-next-up.vercel.app` and add
   `https://project-next-up.vercel.app/auth/callback` and
   `https://project-next-up.vercel.app/reset-password` to Redirect URLs.
5. Send a sign-up confirmation and a password-reset message to a real
   `@vitstudent.ac.in` mailbox. Confirm the links open the production app and
   that the mail passes SPF/DKIM in the recipient mailbox.
6. Verify that Vercel's `NEXT_PUBLIC_SUPABASE_URL` and Render's
   `SUPABASE_URL` identify the same Supabase project. The browser obtains the
   JWT from the former, while the API verifies it against the latter.

Do not place SMTP credentials in Vercel, Render, or frontend environment
variables for this flow: Supabase Auth owns the mail delivery and stores the
SMTP configuration itself.

## Immediate mitigation

Until custom SMTP is enabled, email/password sign-up cannot reliably support a
multi-user production app. Ask affected students to use the existing Google
sign-up option where possible and avoid repeated submits. The UI now explains
this failure clearly, but it cannot increase a provider-side email quota.

## References

- https://supabase.com/docs/guides/auth/auth-smtp
- https://supabase.com/docs/guides/auth/rate-limits
