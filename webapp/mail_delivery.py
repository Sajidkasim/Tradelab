"""SMTP transport shared by the Journal and the Bullpen."""
import smtplib
import ssl


def send_gmail(message, sender, password, recipients):
    tls = ssl.create_default_context()
    smtp = None
    try:
        try:
            smtp = smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=5, context=tls)
            smtp.login(sender, password)
        except (smtplib.SMTPServerDisconnected, TimeoutError, ConnectionError):
            if smtp is not None:
                smtp.close()
                smtp = None
            smtp = smtplib.SMTP("smtp.gmail.com", 587, timeout=8)
            smtp.starttls(context=tls)
            smtp.login(sender, password)
        return smtp.send_message(message, from_addr=sender, to_addrs=recipients)
    finally:
        if smtp is not None:
            smtp.close()

