package expo.modules.nestwiselogin

import android.view.autofill.AutofillValue
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class CredentialFieldTest {
  @Test fun ordinaryTextChangesNeverRequestAutomaticSignIn() {
    val field = CredentialField(RuntimeEnvironment.getApplication())
    var submissions = 0
    field.filled = { submissions++ }
    field.setText("typed")
    field.append(" or pasted")
    assertEquals(0, submissions)
  }

  @Test fun actualAutofillSignalsOnlyAfterTheCompleteValueIsAvailable() {
    val field = CredentialField(RuntimeEnvironment.getApplication())
    var submissions = 0
    field.filled = {
      submissions++
      assertEquals("saved credential", field.text.toString())
      assertFalse(field.filling)
    }
    field.autofill(AutofillValue.forText("saved credential"))
    assertEquals(1, submissions)
  }

  @Test fun disabledFieldRejectsLateAutofill() {
    val field = CredentialField(RuntimeEnvironment.getApplication())
    var submissions = 0
    field.filled = { submissions++ }
    field.isEnabled = false
    field.autofill(AutofillValue.forText("late credential"))
    assertEquals("", field.text.toString())
    assertEquals(0, submissions)
  }
}
