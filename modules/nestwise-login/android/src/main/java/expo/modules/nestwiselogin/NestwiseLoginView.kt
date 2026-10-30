package expo.modules.nestwiselogin

import android.content.Context
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.View
import android.view.autofill.AutofillValue
import android.view.inputmethod.EditorInfo
import android.widget.EditText
import android.widget.TextView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

// Only Android's actual autofill callback can request automatic submission.
// Typing, pasting, focus changes and cancelled authentication never do so.
internal class CredentialField(context: Context) : EditText(context) {
  var filling = false
  var filled: (() -> Unit)? = null
  override fun autofill(value: AutofillValue) {
    if (Build.VERSION.SDK_INT < 26 || !isEnabled || !value.isText) return
    filling = true
    try { super.autofill(value) } finally { filling = false }
    filled?.invoke()
  }
}

class NestwiseLoginView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  override val shouldUseAndroidLayout = true
  private val onCredentialsChange by EventDispatcher()
  private val onSubmitCredentials by EventDispatcher()
  private val email = CredentialField(context)
  private val password = CredentialField(context)
  val emailLabel = TextView(context)
  val passwordLabel = TextView(context)
  private var initialized = false
  private var reset = -1
  private var generation = 0
  private var submitted = false
  private var suppressChanges = false

  private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
  private fun credentials(): Map<String, Any> = mapOf("email" to email.text.toString(), "password" to password.text.toString())

  init {
    orientation = VERTICAL
    email.inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS
    password.inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
    email.imeOptions = EditorInfo.IME_ACTION_NEXT
    password.imeOptions = EditorInfo.IME_ACTION_DONE
    listOf(emailLabel, passwordLabel).forEach { it.textSize = 14f; it.setTextColor(Color.rgb(35, 61, 52)) }
    listOf(email, password).forEach { field ->
      field.id = View.generateViewId()
      field.setSingleLine(true)
      field.textSize = 16f
      field.setTextColor(Color.rgb(35, 61, 52))
      field.setPadding(dp(12), dp(8), dp(12), dp(8))
      field.background = GradientDrawable().apply {
        setColor(Color.WHITE); cornerRadius = dp(10).toFloat(); setStroke(dp(1), Color.rgb(218, 228, 222))
      }
      field.layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, 0, 1f).apply { topMargin = dp(6); bottomMargin = dp(12) }
      field.isSaveEnabled = false
      if (Build.VERSION.SDK_INT >= 26) field.importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_YES
      field.addTextChangedListener(object : TextWatcher {
        override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
        override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
        override fun afterTextChanged(s: Editable?) {
          if (suppressChanges) return
          if (!field.filling) { generation++; submitted = false }
          onCredentialsChange(credentials())
        }
      })
    }
    emailLabel.labelFor = email.id
    passwordLabel.labelFor = password.id
    if (Build.VERSION.SDK_INT >= 26) {
      email.setAutofillHints(View.AUTOFILL_HINT_USERNAME, View.AUTOFILL_HINT_EMAIL_ADDRESS)
      password.setAutofillHints(View.AUTOFILL_HINT_PASSWORD)
    }
    email.setOnEditorActionListener { _, action, _ ->
      if (action == EditorInfo.IME_ACTION_NEXT) { password.requestFocus(); true } else false
    }
    password.setOnEditorActionListener { _, action, _ ->
      if (action == EditorInfo.IME_ACTION_DONE) { submit(); true } else false
    }
    password.filled = {
      val expected = ++generation
      // Autofill can fill the password before the username within the same UI turn.
      post { if (expected == generation && isAttachedToWindow) submit() }
    }
    addView(emailLabel); addView(email); addView(passwordLabel); addView(password)
  }

  private fun submit() {
    if (submitted || !password.isEnabled || email.text.toString().isBlank() || password.text.isNullOrEmpty()) return
    submitted = true
    onSubmitCredentials(credentials())
  }

  fun initializeEmail(value: String) {
    if (initialized) return
    initialized = true
    suppressChanges = true
    email.setText(value)
    suppressChanges = false
  }

  fun setEditable(value: Boolean) {
    email.isEnabled = value; password.isEnabled = value
    if (!value) generation++
    if (value) submitted = false
  }

  fun resetPassword(value: Int) {
    if (reset == value) return
    reset = value; generation++; submitted = false
    suppressChanges = true
    password.text?.clear()
    suppressChanges = false
  }

  override fun onDetachedFromWindow() {
    generation++
    suppressChanges = true
    password.text?.clear()
    suppressChanges = false
    super.onDetachedFromWindow()
  }
}
