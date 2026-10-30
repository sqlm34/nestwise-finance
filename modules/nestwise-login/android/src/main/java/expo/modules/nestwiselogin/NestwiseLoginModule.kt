package expo.modules.nestwiselogin

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class NestwiseLoginModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NestwiseLogin")
    View(NestwiseLoginView::class) {
      Events("onCredentialsChange", "onSubmitCredentials")
      Prop("emailLabel") { view: NestwiseLoginView, value: String -> view.emailLabel.text = value }
      Prop("passwordLabel") { view: NestwiseLoginView, value: String -> view.passwordLabel.text = value }
      Prop("initialEmail") { view: NestwiseLoginView, value: String -> view.initializeEmail(value) }
      Prop("editable") { view: NestwiseLoginView, value: Boolean -> view.setEditable(value) }
      Prop("passwordReset") { view: NestwiseLoginView, value: Int -> view.resetPassword(value) }
    }
  }
}
