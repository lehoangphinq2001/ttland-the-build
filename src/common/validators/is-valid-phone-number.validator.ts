import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ name: 'InvalidPhoneNumber', async: false })
export class IsValidPhoneNumber implements ValidatorConstraintInterface {
  validate(text: string) {
    return /\(?([0-9]{3})\)?([ .-]?)([0-9]{3})\2([0-9]{4})/.test(text);
  }

  defaultMessage() {
    return `Invalid phone number`;
  }
}
