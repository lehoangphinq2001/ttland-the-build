import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ name: 'ContainsAtLeastOneNumber', async: false })
export class ContainsAtLeastOneNumber implements ValidatorConstraintInterface {
  validate(text: string) {
    return /\d/.test(text);
  }

  defaultMessage() {
    return `Password must contain at least one number`;
  }
}
