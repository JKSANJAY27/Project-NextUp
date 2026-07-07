import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotenv import load_dotenv
load_dotenv()

from app.services.email_parser import extract_company_from_subject, is_generic_company_name

subject1 = "Congratulations !! Infosys HackwithInfy Digital Specialist Engineer (Trainee), Specialist Programmer - L1 (Trainee), Specialist Programmer - L2 (Trainee) selection list 2027 batch !!"
subject2 = "Urgent: Mandatory Infosys Registration - 2027 Batch"

print("subject1 recovery:", extract_company_from_subject(subject1))
print("subject1 generic?", is_generic_company_name(extract_company_from_subject(subject1)))

print("subject2 recovery:", extract_company_from_subject(subject2))
print("subject2 generic?", is_generic_company_name(extract_company_from_subject(subject2)))
